/** One connection per (language, workspace root) pair — unlike MCP's flat list of independent user-configured servers, the LSP data model is keyed two levels deep. */
export type LspServerStatus = 'starting' | 'running' | 'error' | 'stopped';

export interface LspServerState {
  language: string;
  workspaceRoot: string;
  status: LspServerStatus;
  error?: string;
}

/** A server's own token-type/modifier vocabulary and ordering, from its `initialize` response — authoritative for decoding that server's `semanticTokens` `data` arrays; not necessarily the same order (or even the same set) as another server for another language. */
export interface LspSemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

/**
 * A generic JSON-RPC envelope, not a per-method union — LSP has dozens of
 * request/notification shapes on both directions and the actual typing
 * happens renderer-side against `vscode-languageserver-protocol`'s types.
 * Mirrors LSP's own wire shape directly (id present = request/response,
 * absent = notification).
 */
export interface LspRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface LspMessageEvent {
  language: string;
  workspaceRoot: string;
  message: LspRpcMessage;
}

export type LspIpcContract = {
  /** Starts the server for this (language, workspace root) if not already running/starting. Resolves once the `initialize` handshake completes; false if no server binary is available on PATH for this language. */
  'lsp:ensureServer': (language: string, workspaceRoot: string) => Promise<boolean>;
  'lsp:getServerStates': () => Promise<LspServerState[]>;
  'lsp:isLanguageSupported': (language: string) => Promise<boolean>;
  /** Null if the server never advertised semanticTokensProvider in its initialize response (some servers don't implement it) or isn't running yet. */
  'lsp:getSemanticTokensLegend': (language: string, workspaceRoot: string) => Promise<LspSemanticTokensLegend | null>;
};
