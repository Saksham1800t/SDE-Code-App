import { randomUUID } from 'crypto';

/** A unique opaque string ID; prefer this over ad hoc `Math.random().toString(36)` IDs used in a few older places — collision-resistant, no truncation. */
export function generateId(): string {
  return randomUUID();
}
