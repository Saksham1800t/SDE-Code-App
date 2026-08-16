import { isAIStreamBusy, markAIStreamStart, markAIStreamEnd } from './aiStreamLock';

/**
 * Runs a single non-agentic AI prompt and returns the accumulated response
 * text. Provider/network errors arrive via the separate onAIErr push event
 * (not by rejecting the invoke), so they're captured and re-thrown here for
 * one try/catch. ai:chunk/ai:err now carry a per-request sessionId (see
 * AiQueryOptions.sessionId), so this no longer NEEDS aiStreamLock to avoid
 * cross-contaminating with another in-flight AI call — kept anyway
 * (unrelated purpose): TerminalArea's command-safety gate checks
 * isAIStreamBusy() to skip firing while the user is already mid-chat, a
 * product choice about not overlapping AI activity in front of the user,
 * not a technical necessity.
 */
export async function oneShotAIQuery(provider: string, model: string, prompt: string): Promise<string> {
  if (isAIStreamBusy()) {
    throw new Error('An AI request is already in progress.');
  }
  markAIStreamStart();

  const api = window.api;
  const sessionId = crypto.randomUUID();
  let result = '';
  let error: string | null = null;
  const offChunk = api.onAIChunk((chunkSessionId: string, chunk: string) => {
    if (chunkSessionId === sessionId) result += chunk;
  });
  const offErr = api.onAIErr((errSessionId: string, err: string) => {
    if (errSessionId === sessionId) error = err;
  });

  try {
    await api.queryAI(provider, model, prompt, { sessionId });
  } finally {
    offChunk();
    offErr();
    markAIStreamEnd();
  }

  if (error) throw new Error(error);
  return result.trim();
}
