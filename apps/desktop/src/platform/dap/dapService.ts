import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import type { DapSessionState, DapSessionStatus, DapMessage } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import type { IExtensionDebugAdapterProvider } from './extensibility';

/** Built-in languages the app ships debugging support for regardless of installed extensions — same shape/fallback role as LANGUAGE_SERVERS in platform/lsp/lspService.ts. */
const DEBUG_ADAPTERS: Record<string, { binary: string; args: string[] }> = {
  python: { binary: 'python', args: ['-m', 'debugpy.adapter'] },
};

interface DapSession {
  sessionId: string;
  process: ChildProcessWithoutNullStreams | null;
  status: DapSessionStatus;
  error?: string;
  buffer: Buffer;
}

export interface IDapService {
  startSession(sessionId: string, language: string, program: string, cwd: string): Promise<boolean>;
  getSessionStates(): DapSessionState[];
  stopSession(sessionId: string): void;
  /** Relays a renderer-originated DAP message to the adapter's stdin, framed. No-ops if the session isn't running. */
  sendToSession(sessionId: string, message: DapMessage): void;
  setBroadcastWindow(window: BrowserWindow): void;
  setExtensionDebugAdapterProvider(provider: IExtensionDebugAdapterProvider): void;
  disposeAll(): void;
}

export const IDapService = createServiceIdentifier<IDapService>('dapService');

/**
 * Spawn+frame+relay only — no DAP protocol logic lives here at all, not
 * even `initialize` (contrast with LspService, which does own the LSP
 * handshake). The renderer drives the entire DAP session lifecycle
 * (initialize/launch/setBreakpoints/configurationDone, stopped/continued
 * event handling, stackTrace/scopes/variables requests) because that's
 * where the debug UI state (call stack, variables, breakpoint decorations)
 * has to live anyway — same "renderer owns protocol/document state, main
 * is a thin transport" split as LSP, just with nothing left for main to
 * own beyond the process itself.
 */
export class DapService implements IDapService {
  static readonly inject = [ILogService] as const;
  private sessions = new Map<string, DapSession>();
  private broadcastWindow: BrowserWindow | null = null;
  private pathCache: Map<string, string | null> = new Map();
  private extensionProvider: IExtensionDebugAdapterProvider | null = null;

  constructor(private readonly logService: ILogService) {}

  setBroadcastWindow(window: BrowserWindow): void {
    this.broadcastWindow = window;
  }

  setExtensionDebugAdapterProvider(provider: IExtensionDebugAdapterProvider): void {
    this.extensionProvider = provider;
  }

  /** Extension-declared adapters are checked first — lets an installed extension override the built-in binary for a language, not just add new ones — falling back to the built-in table. */
  private resolveAdapterConfig(language: string): { binary: string; args: string[] } | null {
    const fromExtension = this.extensionProvider?.listDebugAdapters().find((a) => a.languageId === language);
    if (fromExtension) return { binary: fromExtension.binary, args: fromExtension.args ?? [] };
    return DEBUG_ADAPTERS[language] ?? null;
  }

  getSessionStates(): DapSessionState[] {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      error: s.error,
    }));
  }

  async startSession(sessionId: string, language: string, program: string, cwd: string): Promise<boolean> {
    const config = this.resolveAdapterConfig(language);
    if (!config) return false;
    const binaryPath = await this.findOnPath(config.binary);
    if (!binaryPath) return false;

    const session: DapSession = { sessionId, process: null, status: 'starting', buffer: Buffer.alloc(0) };
    this.sessions.set(sessionId, session);

    try {
      const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binaryPath);
      const child = spawn(binaryPath, config.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: needsShell });
      session.process = child;
      session.status = 'running';

      child.stdout.on('data', (chunk: Buffer) => this.handleStdout(sessionId, chunk));
      child.stderr.on('data', (chunk: Buffer) => this.logService.warn(`DAP adapter "${sessionId}" stderr:`, chunk.toString()));
      child.on('error', (err) => this.failSession(sessionId, err.message));
      child.on('exit', (code) => {
        const current = this.sessions.get(sessionId);
        if (current && current.status !== 'terminated') {
          current.status = 'terminated';
          this.logService.info(`DAP session "${sessionId}" adapter exited (code ${code}).`);
        }
      });

      this.logService.info(`DAP adapter spawned for session "${sessionId}" (program: ${program}).`);
      return true;
    } catch (err: any) {
      this.failSession(sessionId, err?.message || 'Failed to start debug adapter.');
      return false;
    }
  }

  sendToSession(sessionId: string, message: DapMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session?.process || session.status !== 'running') return;
    this.write(session, message);
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.stopEntry(session);
    this.sessions.delete(sessionId);
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) this.stopEntry(session);
    this.sessions.clear();
  }

  private stopEntry(session: DapSession): void {
    if (session.process) {
      session.process.removeAllListeners();
      session.process.kill();
      session.process = null;
    }
    session.status = 'terminated';
    session.buffer = Buffer.alloc(0);
  }

  private async findOnPath(binaryName: string): Promise<string | null> {
    if (this.pathCache.has(binaryName)) return this.pathCache.get(binaryName)!;

    const isWin = process.platform === 'win32';
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const dirs = (process.env[pathKey] ?? '').split(path.delimiter).map((p) => p.trim()).filter(Boolean);
    const extensions = isWin ? ['.CMD', '.EXE', '.BAT', ''] : [''];

    let found: string | null = null;
    for (const dir of dirs) {
      for (const ext of extensions) {
        const candidate = path.join(dir, `${binaryName}${ext}`);
        if (fs.existsSync(candidate)) { found = candidate; break; }
      }
      if (found) break;
    }
    this.pathCache.set(binaryName, found);
    return found;
  }

  private failSession(sessionId: string, message: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'error';
    session.error = message;
    this.stopEntry(session);
    this.logService.error(`DAP session "${sessionId}" failed:`, message);
  }

  // ---- Content-Length framing — identical scheme to LspService, DAP shares the same spec-mandated framing. ----

  private write(session: DapSession, message: DapMessage): void {
    if (!session.process) return;
    const json = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii');
    session.process.stdin.write(Buffer.concat([header, json]));
  }

  private handleStdout(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.buffer = Buffer.concat([session.buffer, chunk]);

    while (true) {
      const headerEnd = session.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = session.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!lengthMatch) {
        session.buffer = session.buffer.subarray(headerEnd + 4);
        continue;
      }

      const bodyStart = headerEnd + 4;
      const bodyLength = parseInt(lengthMatch[1], 10);
      if (session.buffer.length < bodyStart + bodyLength) return;

      const body = session.buffer.subarray(bodyStart, bodyStart + bodyLength).toString('utf8');
      session.buffer = session.buffer.subarray(bodyStart + bodyLength);

      try {
        this.relayToRenderer(sessionId, JSON.parse(body));
      } catch (err) {
        this.logService.error(`Failed to parse DAP message from session "${sessionId}":`, err);
      }
    }
  }

  private relayToRenderer(sessionId: string, message: DapMessage): void {
    if (this.broadcastWindow && !this.broadcastWindow.isDestroyed()) {
      this.broadcastWindow.webContents.send('dap:message', { sessionId, message });
    }
  }
}
