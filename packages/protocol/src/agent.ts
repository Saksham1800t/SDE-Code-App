import type { AiQueryOptions } from './ai';

/** One file's proposed change; `originalContent` is captured once per turn so re-edits don't overwrite the diff baseline. */
export interface AgentFileChange {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  isNew: boolean;
  isDeleted: boolean;
}

/** A single tool invocation, rendered as a past-tense progress line in the chat transcript. */
export interface AgentToolCallEvent {
  toolName: string;
  argsSummary: string;
  resultSummary: string;
}

/** Blocks the agent on explicit user Approve/Deny for a tool call whose Agent Profile policy is "ask"; `requestId` round-trips via ai:agentApprovalResponse. `argsSummary` is a short human-readable description of the call (the shell command itself for run_terminal_command, a file path for file tools, etc). */
export interface AgentApprovalRequest {
  requestId: string;
  toolName: string;
  argsSummary: string;
}

export type AgentToolPolicy = 'allow' | 'ask' | 'deny';

/** The 7 built-in agent tools an Agent Profile can govern — see agentTools.ts. Extension-contributed tools and repo-mode's git-only toolset are deliberately out of scope (unknown side effects / fixed toolset, respectively). */
export const AGENT_POLICY_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'search_files',
  'propose_file_edit',
  'create_file',
  'delete_file',
  'run_terminal_command',
] as const;

export type AgentPolicyToolName = (typeof AGENT_POLICY_TOOL_NAMES)[number];

/** Matches pre-Agent-Profiles behavior exactly: every tool runs immediately except run_terminal_command, which always asks. */
export const DEFAULT_AGENT_TOOL_POLICIES: Record<AgentPolicyToolName, AgentToolPolicy> = {
  read_file: 'allow',
  list_directory: 'allow',
  search_files: 'allow',
  propose_file_edit: 'allow',
  create_file: 'allow',
  delete_file: 'allow',
  run_terminal_command: 'ask',
};

export const AGENT_PROFILE_PRESETS: Record<'read-only' | 'full-access', Record<AgentPolicyToolName, AgentToolPolicy>> = {
  'read-only': {
    read_file: 'allow',
    list_directory: 'allow',
    search_files: 'allow',
    propose_file_edit: 'deny',
    create_file: 'deny',
    delete_file: 'deny',
    run_terminal_command: 'deny',
  },
  'full-access': {
    read_file: 'allow',
    list_directory: 'allow',
    search_files: 'allow',
    propose_file_edit: 'allow',
    create_file: 'allow',
    delete_file: 'allow',
    run_terminal_command: 'allow',
  },
};

/** Only `ai:agentQuery` is invoke/handle-shaped; the rest of the agent protocol is push events or fire-and-forget, not in this contract. */
export type AgentIpcContract = {
  'ai:agentQuery': (provider: string, model: string, prompt: string, options: AiQueryOptions) => Promise<void>;
};
