import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import type { LspServerState, LspServerStatus, LspRpcMessage, LspSemanticTokensLegend } from '@sde-code/protocol';

// The full LSP-spec vocabulary, declared so a server never has to filter its legend down to something we claim not to understand — the server's *actual* legend (which types/modifiers it uses and in what order) still comes back in its initialize response and is authoritative for decoding that server's token data.
const SEMANTIC_TOKEN_TYPES = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'];
const SEMANTIC_TOKEN_MODIFIERS = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'];
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import type { IExtensionLanguageServerProvider } from './extensibility';

/** Built-in languages the app ships support for regardless of installed extensions — the table `resolveServerConfig` falls back to once no extension claims a language. */
const LANGUAGE_SERVERS: Record<string, { binary: string; args: string[] }> = {
  python: { binary: 'pyright-langserver', args: ['--stdio'] },
};

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ConnectedServer {
  language: string;
  workspaceRoot: string;
  process: ChildProcessWithoutNullStreams | null;
  status: LspServerStatus;
  error?: string;
  nextRequestId: number;
  /** Only the handshake request (`initialize`) is ever tracked here — every other request/response, in either direction, is a blind relay to the renderer once a server is up. See the class doc comment. */
  pending: Map<number, PendingRequest>;
  buffer: Buffer;
  /** From the initialize response's capabilities.semanticTokensProvider.legend — null if this server never advertised semantic tokens support at all. */
  semanticTokensLegend: LspSemanticTokensLegend | null;
}

export interface ILspService {
  ensureServer(language: string, workspaceRoot: string): Promise<boolean>;
  getServerStates(): LspServerState[];
  isLanguageSupported(language: string): Promise<boolean>;
  /** Relays a renderer-originated message to the server's stdin, framed. No-ops if the server isn't running. */
  sendToServer(language: string, workspaceRoot: string, message: LspRpcMessage): void;
  getSemanticTokensLegend(language: string, workspaceRoot: string): LspSemanticTokensLegend | null;
  setBroadcastWindow(window: BrowserWindow): void;
  setExtensionLanguageServerProvider(provider: IExtensionLanguageServerProvider): void;
  disposeAll(): void;
}

export const ILspService = createServiceIdentifier<ILspService>('lspService');

/**
 * JSON-RPC-over-stdio client, same overall shape as McpService — spawn,
 * frame, correlate-by-id, track lifecycle. Two things LSP's own spec forces
 * that MCP never needed:
 *
 *  1. Content-Length-prefixed framing (LSP spec), not MCP's newline-delimited JSON.
 *  2. The server talks first, sometimes — it issues its own requests
 *     (`workspace/configuration`, `client/registerCapability`) and pushes
 *     unprompted notifications (`textDocument/publishDiagnostics`). This
 *     class answers the small "safe to auto-ack" set of server-initiated
 *     requests itself and relays everything else — every notification, and
 *     every response to a request the *renderer* sent — to the renderer,
 *     which owns the real protocol/document-state logic (Monaco lives
 *     there, not in main). Only the one-time `initialize` handshake is
 *     tracked as "this main process's own pending request" via `pending`;
 *     by the time the renderer sends anything, that request has already
 *     resolved, so there's no id-namespace collision between main's and
 *     the renderer's own request ids.
 */
export class LspService implements ILspService {
  static readonly inject = [ILogService] as const;
  private servers = new Map<string, ConnectedServer>();
  private broadcastWindow: BrowserWindow | null = null;
  private pathCache: Map<string, string | null> = new Map();
  private extensionProvider: IExtensionLanguageServerProvider | null = null;
  /** Dedupes concurrent ensureServer() calls for the same key onto a single in-flight promise — without this, a second caller arriving while status is still 'starting' would resolve true before the initialize handshake (and semanticTokensLegend capture) actually finished. */
  private pendingEnsure: Map<string, Promise<boolean>> = new Map();

  constructor(private readonly logService: ILogService) {}

  setBroadcastWindow(window: BrowserWindow): void {
    this.broadcastWindow = window;
  }

  setExtensionLanguageServerProvider(provider: IExtensionLanguageServerProvider): void {
    this.extensionProvider = provider;
  }

  /** Extension-declared servers are checked first — lets an installed extension override the built-in binary for a language, not just add new ones — falling back to the built-in table. */
  private resolveServerConfig(language: string): { binary: string; args: string[] } | null {
    const fromExtension = this.extensionProvider?.listLanguageServers().find((s) => s.languageId === language);
    if (fromExtension) return { binary: fromExtension.binary, args: fromExtension.args ?? [] };
    return LANGUAGE_SERVERS[language] ?? null;
  }

  async isLanguageSupported(language: string): Promise<boolean> {
    const config = this.resolveServerConfig(language);
    if (!config) return false;
    return (await this.findOnPath(config.binary)) !== null;
  }

  getServerStates(): LspServerState[] {
    return Array.from(this.servers.values()).map((s) => ({
      language: s.language,
      workspaceRoot: s.workspaceRoot,
      status: s.status,
      error: s.error,
    }));
  }

  async ensureServer(language: string, workspaceRoot: string): Promise<boolean> {
    const key = this.keyOf(language, workspaceRoot);
    const existing = this.servers.get(key);
    if (existing && existing.status === 'running') return true;

    const pending = this.pendingEnsure.get(key);
    if (pending) return pending;

    const promise = this.startServer(key, language, workspaceRoot).finally(() => this.pendingEnsure.delete(key));
    this.pendingEnsure.set(key, promise);
    return promise;
  }

  private async startServer(key: string, language: string, workspaceRoot: string): Promise<boolean> {
    const config = this.resolveServerConfig(language);
    if (!config) return false;
    const binaryPath = await this.findOnPath(config.binary);
    if (!binaryPath) return false;

    const entry: ConnectedServer = {
      language, workspaceRoot, process: null, status: 'starting',
      nextRequestId: 1, pending: new Map(), buffer: Buffer.alloc(0),
      semanticTokensLegend: null,
    };
    this.servers.set(key, entry);

    try {
      // Windows npm-global installs are .cmd shims (batch files), which
      // Node's spawn() can't exec directly — EINVAL — without shell:true.
      // Safe here specifically because binaryPath came from a PATH lookup
      // against our own fixed LANGUAGE_SERVERS table (not user input) and
      // args is a fixed array literal, so there's no injection surface for
      // shell:true's usual risk (unlike execSync's single command STRING,
      // which is what the extension-installer's tar call used to use).
      const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binaryPath);
      const child = spawn(binaryPath, config.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: needsShell });
      entry.process = child;

      child.stdout.on('data', (chunk: Buffer) => this.handleStdout(key, chunk));
      child.stderr.on('data', (chunk: Buffer) => this.logService.warn(`LSP server "${language}" stderr:`, chunk.toString()));
      child.on('error', (err) => this.failServer(key, err.message));
      child.on('exit', (code) => {
        const current = this.servers.get(key);
        if (current && current.status !== 'stopped') this.failServer(key, `Process exited (code ${code}).`);
      });

      const initResult = await this.sendRequest<{ capabilities?: { semanticTokensProvider?: { legend?: LspSemanticTokensLegend } } }>(key, 'initialize', {
        processId: process.pid,
        rootUri: this.toFileUri(workspaceRoot),
        workspaceFolders: [{ uri: this.toFileUri(workspaceRoot), name: path.basename(workspaceRoot) }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: true },
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: {},
            publishDiagnostics: { relatedInformation: true },
            semanticTokens: {
              requests: { full: true },
              tokenTypes: SEMANTIC_TOKEN_TYPES,
              tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
              formats: ['relative'],
            },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      });
      this.sendNotification(key, 'initialized', {});
      entry.semanticTokensLegend = initResult?.capabilities?.semanticTokensProvider?.legend ?? null;

      entry.status = 'running';
      entry.error = undefined;
      this.logService.info(`LSP server "${language}" running for ${workspaceRoot}.`);
      return true;
    } catch (err: any) {
      this.failServer(key, err?.message || 'Failed to start language server.');
      return false;
    }
  }

  sendToServer(language: string, workspaceRoot: string, message: LspRpcMessage): void {
    const entry = this.servers.get(this.keyOf(language, workspaceRoot));
    if (!entry?.process || entry.status !== 'running') return;
    this.write(entry, message);
  }

  getSemanticTokensLegend(language: string, workspaceRoot: string): LspSemanticTokensLegend | null {
    return this.servers.get(this.keyOf(language, workspaceRoot))?.semanticTokensLegend ?? null;
  }

  disposeAll(): void {
    for (const entry of this.servers.values()) this.stopEntry(entry);
    this.servers.clear();
  }

  private keyOf(language: string, workspaceRoot: string): string {
    return `${language}::${workspaceRoot}`;
  }

  private toFileUri(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return `file:///${normalized.replace(/^\/+/, '')}`;
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

  private failServer(key: string, message: string): void {
    const entry = this.servers.get(key);
    if (!entry) return;
    entry.status = 'error';
    entry.error = message;
    this.stopEntry(entry, false);
    this.logService.error(`LSP server "${key}" failed:`, message);
  }

  private stopEntry(entry: ConnectedServer, remove = true): void {
    if (entry.process) {
      entry.process.removeAllListeners();
      entry.process.kill();
      entry.process = null;
    }
    for (const pending of entry.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Server stopped.'));
    }
    entry.pending.clear();
    entry.buffer = Buffer.alloc(0);
    if (remove) entry.status = 'stopped';
  }

  // ---- Content-Length framing (LSP spec, byte length not char length) ----

  private write(entry: ConnectedServer, message: LspRpcMessage): void {
    if (!entry.process) return;
    const json = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii');
    entry.process.stdin.write(Buffer.concat([header, json]));
  }

  private handleStdout(key: string, chunk: Buffer): void {
    const entry = this.servers.get(key);
    if (!entry) return;
    entry.buffer = Buffer.concat([entry.buffer, chunk]);

    // A stream can carry several complete frames per chunk, and a frame can
    // span several chunks — loop until what's buffered is no longer a full frame.
    while (true) {
      const headerEnd = entry.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = entry.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!lengthMatch) {
        // Malformed frame — drop it rather than spin forever on the same bytes.
        entry.buffer = entry.buffer.subarray(headerEnd + 4);
        continue;
      }

      const bodyStart = headerEnd + 4;
      const bodyLength = parseInt(lengthMatch[1], 10);
      if (entry.buffer.length < bodyStart + bodyLength) return; // wait for more data

      const body = entry.buffer.subarray(bodyStart, bodyStart + bodyLength).toString('utf8');
      entry.buffer = entry.buffer.subarray(bodyStart + bodyLength);

      try {
        this.handleMessage(entry, JSON.parse(body));
      } catch (err) {
        this.logService.error(`Failed to parse LSP message from "${key}":`, err);
      }
    }
  }

  private handleMessage(entry: ConnectedServer, message: LspRpcMessage): void {
    // Response to main's own pending request (only ever `initialize`).
    if (message.id !== undefined && typeof message.id === 'number' && entry.pending.has(message.id)) {
      const pending = entry.pending.get(message.id)!;
      entry.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    // A small set of server-initiated requests are safe to auto-acknowledge
    // here so the server doesn't stall waiting on a renderer that may not
    // even have a document open yet. Everything else — every notification,
    // and every response to a request the renderer itself sent — is relayed
    // as-is; the renderer's own connection owns real protocol/document state.
    if (message.method === 'workspace/configuration' && message.id !== undefined) {
      const items = ((message.params as any)?.items ?? []) as unknown[];
      this.write(entry, { jsonrpc: '2.0', id: message.id, result: items.map(() => ({})) });
      return;
    }
    if ((message.method === 'client/registerCapability' || message.method === 'client/unregisterCapability' || message.method === 'window/workDoneProgress/create') && message.id !== undefined) {
      this.write(entry, { jsonrpc: '2.0', id: message.id, result: null });
      return;
    }

    this.relayToRenderer(entry.language, entry.workspaceRoot, message);
  }

  private relayToRenderer(language: string, workspaceRoot: string, message: LspRpcMessage): void {
    if (this.broadcastWindow && !this.broadcastWindow.isDestroyed()) {
      this.broadcastWindow.webContents.send('lsp:message', { language, workspaceRoot, message });
    }
  }

  private sendRequest<T = any>(key: string, method: string, params: unknown, timeoutMs = 15000): Promise<T | undefined> {
    const entry = this.servers.get(key);
    if (!entry?.process) return Promise.reject(new Error('Server is not running.'));
    const id = entry.nextRequestId++;
    return new Promise<T | undefined>((resolve, reject) => {
      const timeout = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error(`LSP request "${method}" timed out.`));
      }, timeoutMs);
      entry.pending.set(id, { resolve, reject, timeout });
      this.write(entry, { jsonrpc: '2.0', id, method, params } as LspRpcMessage);
    });
  }

  private sendNotification(key: string, method: string, params: unknown): void {
    const entry = this.servers.get(key);
    if (!entry?.process) return;
    this.write(entry, { jsonrpc: '2.0', method, params } as LspRpcMessage);
  }
}
