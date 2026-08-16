import type { Message } from './MessageItem';

export type RenderItem =
  | { type: 'message'; msg: Message; key: string }
  | { type: 'tool-run'; items: Message[]; startedAt: number; endedAt: number | null; key: string };

export function groupMessages(messages: Message[]): RenderItem[] {
  const result: RenderItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'tool-progress') {
      const runStart = i;
      const items: Message[] = [];
      while (i < messages.length && messages[i].role === 'tool-progress') {
        items.push(messages[i]);
        i++;
      }
      const startedAt = items[0].timestamp ?? Date.now();
      const next = messages[i];
      const endedAt = next ? (next.timestamp ?? Date.now()) : null;
      result.push({ type: 'tool-run', items, startedAt, endedAt, key: `run-${runStart}` });
    } else {
      result.push({ type: 'message', msg, key: `msg-${i}` });
      i++;
    }
  }

  return result;
}
