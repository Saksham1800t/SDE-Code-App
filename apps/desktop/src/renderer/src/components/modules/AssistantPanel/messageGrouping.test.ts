import { describe, it, expect } from 'vitest';
import { groupMessages } from './messageGrouping';
import type { Message } from './MessageItem';

const user = (content: string, timestamp: number): Message => ({ role: 'user', content, timestamp });
const assistant = (content: string, timestamp: number): Message => ({ role: 'assistant', content, timestamp });
const tool = (content: string, timestamp: number): Message => ({ role: 'tool-progress', content, timestamp });
const approval = (timestamp: number): Message => ({
  role: 'approval-request',
  content: '',
  timestamp,
  approval: { requestId: 'r1', toolName: 'run_terminal_command', argsSummary: 'rm -rf /' },
});

describe('groupMessages', () => {
  it('passes through messages with no tool-progress unchanged', () => {
    const messages = [user('hi', 1000), assistant('hello', 2000)];
    const result = groupMessages(messages);

    expect(result).toEqual([
      { type: 'message', msg: messages[0], key: 'msg-0' },
      { type: 'message', msg: messages[1], key: 'msg-1' },
    ]);
  });

  it('bundles a run of consecutive tool-progress messages into one group', () => {
    const messages = [
      user('do the thing', 1000),
      tool('read_file(a.ts)', 1100),
      tool('write_file(a.ts)', 1300),
      assistant('Done!', 1800),
    ];
    const result = groupMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'message', msg: messages[0], key: 'msg-0' });
    expect(result[1]).toEqual({
      type: 'tool-run',
      items: [messages[1], messages[2]],
      startedAt: 1100,
      endedAt: 1800,
      key: 'run-1',
    });
    expect(result[2]).toEqual({ type: 'message', msg: messages[3], key: 'msg-3' });
  });

  it('leaves endedAt null for a trailing tool-run with nothing after it (still in progress)', () => {
    const messages = [
      user('do the thing', 1000),
      tool('read_file(a.ts)', 1100),
      tool('write_file(a.ts)', 1300),
    ];
    const result = groupMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ type: 'tool-run', startedAt: 1100, endedAt: null });
  });

  it('keeps approval-request messages individually visible instead of grouping them into a run', () => {
    const messages = [
      user('run a command', 1000),
      tool('list_dir(.)', 1100),
      approval(1200),
      tool('run_terminal_command(ls)', 1400),
      assistant('Done!', 1900),
    ];
    const result = groupMessages(messages);

    expect(result.map((r) => r.type)).toEqual(['message', 'tool-run', 'message', 'tool-run', 'message']);
    expect(result[1]).toMatchObject({ type: 'tool-run', items: [messages[1]], endedAt: 1200 });
    expect(result[2]).toEqual({ type: 'message', msg: messages[2], key: 'msg-2' });
    expect(result[3]).toMatchObject({ type: 'tool-run', items: [messages[3]], endedAt: 1900 });
  });

  it('produces independent groups for two separate tool-runs across two user turns', () => {
    const messages = [
      user('first task', 1000),
      tool('a', 1100),
      assistant('done 1', 1500),
      user('second task', 2000),
      tool('b', 2100),
      tool('c', 2200),
      assistant('done 2', 2600),
    ];
    const result = groupMessages(messages);

    const runs = result.filter((r) => r.type === 'tool-run');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ startedAt: 1100, endedAt: 1500 });
    expect(runs[1]).toMatchObject({ startedAt: 2100, endedAt: 2600 });
  });

  it('returns an empty array for an empty message list', () => {
    expect(groupMessages([])).toEqual([]);
  });
});
