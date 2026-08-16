/**
 * Debug Adapter Protocol transport contract. DAP reuses LSP's exact
 * Content-Length-prefixed framing (see platform/lsp/lspService.ts's doc
 * comment) but is NOT JSON-RPC 2.0 — messages are `{seq, type: 'request'|'response'|'event', ...}`,
 * not `{jsonrpc, id, method}`. Main process here is a pure spawn+frame+relay
 * layer, even thinner than LspService's: unlike LSP, main doesn't handle
 * even the `initialize` handshake itself — every message in both
 * directions, including `initialize`, is relayed as-is, because the
 * renderer needs to see the adapter's capabilities response directly and
 * there's no server-initiated-request auto-ack needed for a debugpy MVP.
 */
export type DapSessionStatus = 'starting' | 'running' | 'terminated' | 'error';

export interface DapSessionState {
  sessionId: string;
  status: DapSessionStatus;
  error?: string;
}

export interface DapMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  arguments?: unknown;
  body?: unknown;
  success?: boolean;
  message?: string;
  request_seq?: number;
}

export interface DapMessageEvent {
  sessionId: string;
  message: DapMessage;
}

export type DapIpcContract = {
  /** Spawns a debug adapter for a new session and starts relaying — resolves once the process is spawned, not once debugging has actually started (that's a `initialize`/`launch` exchange the renderer drives itself). False if no debugger is available for `language`. */
  'dap:startSession': (sessionId: string, language: string, program: string, cwd: string) => Promise<boolean>;
  'dap:getSessionStates': () => Promise<DapSessionState[]>;
  'dap:stopSession': (sessionId: string) => Promise<void>;
};
