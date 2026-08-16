/** Only `ai:query` fits the request/response IpcContract shape; ai:abort/chunk/err stay on the raw ipcMain.on/webContents.send pattern. */

export interface AiQueryOptions {
  activeFilePath?: string;
  /** Scopes injected project rules/memories to one project (project_id = workspaceName); absent means none are injected. */
  projectId?: string;
  /** Primary workspace root agent-mode tools resolve relative paths against; only agentQuery() reads it. */
  workspacePath?: string;
  /** Every open workspace folder; agent-mode file tools validate against all of these, not just workspacePath. Falls back to [workspacePath]. */
  workspaceFolders?: string[];
  /** Selects agentQuery()'s tool set: 'agent' (file/terminal tools, default) or 'repo' (read-only git tools for "Ask Repository"). */
  mode?: 'agent' | 'repo';
  /** Scopes this query's abort-controller and streamed chunk/error/event payloads so concurrent queries (e.g. Parallel Agent Threads) never cross-cancel or interleave. Omitted only by direct/test callers that bypass IPC — AiService falls back to a fixed internal id in that case, reproducing pre-multi-session single-active-query behavior exactly. Every IPC/renderer caller must pass a real one. */
  sessionId?: string;
}

export interface AiInlineCompletionRequest {
  provider: string;
  model: string;
  prefix: string;
  suffix: string;
  language: string;
}

export interface AiConnectionTestResult {
  success: boolean;
  message: string;
}

export type AiIpcContract = {
  'ai:query': (provider: string, model: string, prompt: string, options: AiQueryOptions) => Promise<void>;
  // Unlike ai:query, this is plain request/response (a single buffered string), so it uses the normal typed registrar/invoker.
  'ai:completeInline': (request: AiInlineCompletionRequest) => Promise<string>;
  // Fires one minimal request against the provider's saved credentials to power the Settings "Test Connection" button.
  'ai:testConnection': (provider: string) => Promise<AiConnectionTestResult>;
};
