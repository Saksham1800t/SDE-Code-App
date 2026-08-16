/** `ai:chunk`/`ai:err` broadcast to every window listener with no per-request id to filter on, so concurrent AI streams would cross-contaminate; callers of window.api.queryAI must acquire this lock first. */
let busy = false;

export function isAIStreamBusy(): boolean {
  return busy;
}

export function markAIStreamStart(): void {
  busy = true;
}

export function markAIStreamEnd(): void {
  busy = false;
}
