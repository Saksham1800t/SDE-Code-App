import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { AITool } from '@sde-code/sdk';
import type { McpServerConfig, McpServerState, McpServerStatus } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { IDatabaseService } from '../db';
import type { IExtensionToolProvider } from '../ai/extensibility';

const MCP_SERVERS_SETTING_KEY = 'mcp-servers';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = 15000;

interface RawMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ConnectedServer {
  config: McpServerConfig;
  process: ChildProcessWithoutNullStreams | null;
  status: McpServerStatus;
  error?: string;
  tools: RawMcpTool[];
  nextRequestId: number;
  pending: Map<number, PendingRequest>;
  buffer: string;
}

export interface IMcpService extends IExtensionToolProvider {
  initialize(): Promise<void>;
  getServers(): McpServerConfig[];
  saveServer(config: McpServerConfig): Promise<boolean>;
  deleteServer(id: string): Promise<boolean>;
  getServerStates(): McpServerState[];
  reconnectServer(id: string): Promise<boolean>;
  /** Kills every connected server's process — call on app quit, same reasoning as terminal.ts's closeAllTerminalSessions (an unkilled child process can keep Electron's own quit from ever completing). */
  disposeAll(): void;
}

export const IMcpService = createServiceIdentifier<IMcpService>('mcpService');

/** MCP client for stdio-launched local servers — a minimal purpose-built JSON-RPC 2.0 client, not a general SDK; implements IExtensionToolProvider directly so host/services.ts can merge its tools with AIToolRegistry's with no AiService changes. */
export class McpService implements IMcpService {
  static readonly inject = [ILogService, IDatabaseService] as const;
  private servers = new Map<string, ConnectedServer>();

  constructor(
    private readonly logService: ILogService,
    private readonly databaseService: IDatabaseService,
  ) {}

  async initialize(): Promise<void> {
    const configs = this.loadConfigs();
    await Promise.all(configs.map((config) => {
      this.servers.set(config.id, this.freshEntry(config));
      return config.enabled ? this.connect(config) : Promise.resolve();
    }));
  }

  getServers(): McpServerConfig[] {
    return Array.from(this.servers.values()).map((s) => s.config);
  }

  async saveServer(config: McpServerConfig): Promise<boolean> {
    const existing = this.servers.get(config.id);
    if (existing) this.disconnectProcess(existing);
    this.servers.set(config.id, this.freshEntry(config));
    this.persistConfigs();
    if (config.enabled) await this.connect(config);
    return true;
  }

  async deleteServer(id: string): Promise<boolean> {
    const existing = this.servers.get(id);
    if (existing) this.disconnectProcess(existing);
    this.servers.delete(id);
    this.persistConfigs();
    return true;
  }

  getServerStates(): McpServerState[] {
    return Array.from(this.servers.values()).map((s) => ({
      id: s.config.id,
      status: s.status,
      error: s.error,
      toolCount: s.tools.length,
    }));
  }

  async reconnectServer(id: string): Promise<boolean> {
    const entry = this.servers.get(id);
    if (!entry) return false;
    if (entry.process) this.disconnectProcess(entry);
    await this.connect(entry.config);
    return true;
  }

  listTools(): AITool[] {
    const tools: AITool[] = [];
    for (const server of this.servers.values()) {
      if (server.status !== 'connected') continue;
      for (const tool of server.tools) {
        tools.push({
          // Namespaced by server so two servers can't collide on a raw tool name — same idea real MCP clients (Claude Desktop, etc.) use.
          name: `mcp_${server.config.name}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
          description: tool.description || `Tool "${tool.name}" from MCP server "${server.config.name}".`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          execute: (args) => this.callTool(server.config.id, tool.name, args),
        });
      }
    }
    return tools;
  }

  disposeAll(): void {
    for (const entry of this.servers.values()) {
      this.disconnectProcess(entry);
    }
  }

  private freshEntry(config: McpServerConfig): ConnectedServer {
    return { config, process: null, status: 'disconnected', tools: [], nextRequestId: 1, pending: new Map(), buffer: '' };
  }

  private loadConfigs(): McpServerConfig[] {
    try {
      const raw = this.databaseService.getSettings()[MCP_SERVERS_SETTING_KEY];
      return raw ? (JSON.parse(raw) as McpServerConfig[]) : [];
    } catch (err) {
      this.logService.error('Failed to parse stored MCP server configs:', err);
      return [];
    }
  }

  private persistConfigs(): void {
    this.databaseService.setSetting(MCP_SERVERS_SETTING_KEY, JSON.stringify(this.getServers()));
  }

  private async connect(config: McpServerConfig): Promise<void> {
    const entry = this.servers.get(config.id) ?? this.freshEntry(config);
    this.servers.set(config.id, entry);
    entry.status = 'connecting';
    entry.error = undefined;

    try {
      const child = spawn(config.command, config.args, {
        env: { ...process.env, ...(config.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      entry.process = child;

      child.stdout.on('data', (chunk: Buffer) => this.handleStdout(config.id, chunk));
      child.stderr.on('data', (chunk: Buffer) => this.logService.warn(`MCP server "${config.name}" stderr:`, chunk.toString()));
      child.on('error', (err) => {
        this.logService.error(`MCP server "${config.name}" process error:`, err);
        this.failServer(config.id, err.message);
      });
      child.on('exit', (code) => {
        const current = this.servers.get(config.id);
        if (current && current.status !== 'disconnected') {
          this.failServer(config.id, `Process exited (code ${code}).`);
        }
      });

      await this.sendRequest(config.id, 'initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'sde-code', version: '1.0.0' },
      });

      this.sendNotification(config.id, 'notifications/initialized', {});

      const toolsResult = await this.sendRequest<{ tools: RawMcpTool[] }>(config.id, 'tools/list', {});
      const current = this.servers.get(config.id);
      if (!current) return;
      current.tools = toolsResult?.tools || [];
      current.status = 'connected';
      this.logService.info(`MCP server "${config.name}" connected with ${current.tools.length} tool(s).`);
    } catch (err: any) {
      this.failServer(config.id, err?.message || 'Failed to connect.');
    }
  }

  private failServer(id: string, message: string): void {
    const entry = this.servers.get(id);
    if (!entry) return;
    entry.status = 'error';
    entry.error = message;
    entry.tools = [];
    this.disconnectProcess(entry, false);
  }

  private disconnectProcess(entry: ConnectedServer, markDisconnected = true): void {
    if (entry.process) {
      entry.process.removeAllListeners();
      entry.process.kill();
      entry.process = null;
    }
    for (const pending of entry.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Server disconnected.'));
    }
    entry.pending.clear();
    entry.buffer = '';
    if (markDisconnected) {
      entry.status = 'disconnected';
      entry.tools = [];
    }
  }

  private handleStdout(serverId: string, chunk: Buffer): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    entry.buffer += chunk.toString('utf8');
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: any;
      try {
        message = JSON.parse(trimmed);
      } catch {
        // MCP servers sometimes log plain text to stdout alongside JSON-RPC — not every line is a protocol message.
        continue;
      }
      if (message.id !== undefined && entry.pending.has(message.id)) {
        const pending = entry.pending.get(message.id)!;
        entry.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message || 'MCP server returned an error.'));
        else pending.resolve(message.result);
      }
      // Server-initiated notifications (no id) aren't acted on yet — out of scope for this pass.
    }
  }

  private sendRequest<T = any>(serverId: string, method: string, params: unknown): Promise<T | undefined> {
    const entry = this.servers.get(serverId);
    if (!entry?.process) return Promise.reject(new Error('Server is not running.'));
    const id = entry.nextRequestId++;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise<T | undefined>((resolve, reject) => {
      const timeout = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out.`));
      }, REQUEST_TIMEOUT_MS);
      entry.pending.set(id, { resolve, reject, timeout });
      entry.process!.stdin.write(payload, (err) => {
        if (err) {
          entry.pending.delete(id);
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private sendNotification(serverId: string, method: string, params: unknown): void {
    const entry = this.servers.get(serverId);
    if (!entry?.process) return;
    entry.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    try {
      const result = await this.sendRequest<{ content?: { type: string; text?: string }[]; isError?: boolean }>(
        serverId, 'tools/call', { name: toolName, arguments: args },
      );
      const textParts = (result?.content || []).filter((c) => c.type === 'text' && c.text).map((c) => c.text as string);
      const text = textParts.join('\n') || JSON.stringify(result ?? {});
      return result?.isError ? `Error: ${text}` : text;
    } catch (err: any) {
      return `Error calling MCP tool "${toolName}": ${err?.message || 'unknown error'}`;
    }
  }
}
