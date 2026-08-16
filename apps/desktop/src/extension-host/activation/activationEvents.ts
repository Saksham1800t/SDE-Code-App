/** Whether a fired activation event matches anything an extension declared interest in; `"*"` unconditionally matches everything. */
export function matchesActivationEvent(declaredEvents: readonly string[], firedEvent: string): boolean {
  return declaredEvents.includes('*') || declaredEvents.includes(firedEvent);
}
