/**
 * External CLI agents (Aider, the Claude Code CLI, etc.) — spawned as a fully autonomous
 * process (it owns its own reasoning and file edits), with its stdout/stderr streamed
 * read-only into the chat transcript. Deliberately NOT run through AiService's tool-calling
 * loop: real CLI agents don't speak this app's tool-call protocol, and forcing one to would
 * mean nothing works without the user first writing a custom adapter script. See
 * externalAgentService.ts for why this is a plain spawn+stream, not a JSON-RPC client like
 * McpService.
 */
export interface ExternalAgentConfig {
  id: string;
  name: string;
  /** Executable to spawn, e.g. "aider" or "claude" — resolved via PATH, same as any other spawned tool in this app. */
  command: string;
  /**
   * Argument tokens, spawned directly (no shell) so the prompt can never break out as
   * injected shell syntax. Exactly one token should be the literal placeholder "{prompt}" —
   * it's replaced with the user's message as a single argv entry. If no token contains
   * "{prompt}", the prompt is piped to the process's stdin instead (covers tools that read
   * their instructions from stdin rather than a flag).
   */
  args: string[];
}

export interface ExternalAgentRunHandle {
  runId: string;
}

/** Only the CRUD + start/cancel operations are invoke/handle-shaped; the run's actual output arrives via the externalAgent:chunk/done/error push channels (see preload/index.ts), same reasoning as ai.ts's AgentIpcContract note. */
export type ExternalAgentIpcContract = {
  'externalAgent:getConfigs': () => Promise<ExternalAgentConfig[]>;
  /** Upserts by id (a new random id if creating). */
  'externalAgent:saveConfig': (config: ExternalAgentConfig) => Promise<boolean>;
  'externalAgent:deleteConfig': (id: string) => Promise<boolean>;
  'externalAgent:run': (configId: string, prompt: string, workspacePath: string) => Promise<ExternalAgentRunHandle>;
  'externalAgent:cancel': (runId: string) => Promise<void>;
};
