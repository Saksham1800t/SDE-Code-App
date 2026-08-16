import type { AgentFileChange, AgentToolCallEvent, AgentApprovalRequest } from '@sde-code/protocol';

/** Hard cap on tool-call round-trips in one agentQuery() run, so a model stuck in a call/result loop doesn't stream forever; hitting it reports as an error, not a silent truncation. */
export const MAX_AGENT_ITERATIONS = 25;

export interface AgentToolCallRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** The running conversation for one agentQuery() call; deliberately main-process-internal and never serialized over IPC, so an in-progress run has no cross-session persistence by design. */
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

/** Where an agentQuery() run's output goes; kept distinct from AiQuerySink so every method is required and a call site that forgets one fails to compile rather than silently dropping events. */
export interface AgentQuerySink {
  onChunk(text: string): void;
  onToolCall(info: AgentToolCallEvent): void;
  onWorkingSetUpdate(changes: AgentFileChange[]): void;
  /** Fire-and-forget notification that a command needs approval; does NOT return the user's decision — AiService owns that wait itself via pendingApprovals. */
  onApprovalRequest(request: AgentApprovalRequest): void;
  onError(message: string): void;
  onDone(): void;
}
