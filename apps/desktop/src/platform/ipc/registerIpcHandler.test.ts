import { describe, expect, it, vi } from 'vitest';
import { createIpcHandlerRegistrar } from './registerIpcHandler';

const handlers = new Map<string, (...args: any[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  },
}));

type TestContract = {
  'test:add': (a: number, b: number) => Promise<number>;
};

describe('createIpcHandlerRegistrar', () => {
  it('registers a handler under the exact channel name via ipcMain.handle', () => {
    const registerHandler = createIpcHandlerRegistrar<TestContract>();
    registerHandler('test:add', async (a, b) => a + b);

    expect(handlers.has('test:add')).toBe(true);
  });

  it('forwards positional IPC arguments (after the event) to the handler', async () => {
    const registerHandler = createIpcHandlerRegistrar<TestContract>();
    registerHandler('test:add', async (a, b) => a + b);

    const listener = handlers.get('test:add')!;
    const result = await listener({} /* fake IpcMainInvokeEvent */, 2, 3);

    expect(result).toBe(5);
  });
});
