import { describe, expect, it, vi } from 'vitest';
import { createIpcInvokerFactory } from './createIpcInvoker';

const invokeMock = vi.fn(async (_channel: string, ...args: unknown[]): Promise<unknown> => args);

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: (...invokeArgs: unknown[]) => invokeMock(...(invokeArgs as [string, ...unknown[]])),
  },
}));

type TestContract = {
  'test:add': (a: number, b: number) => Promise<number>;
};

describe('createIpcInvokerFactory', () => {
  it('forwards its arguments positionally to ipcRenderer.invoke under the given channel', () => {
    const createInvoker = createIpcInvokerFactory<TestContract>();
    const invoke = createInvoker('test:add');

    invoke(2, 3);

    expect(invokeMock).toHaveBeenCalledWith('test:add', 2, 3);
  });

  it('returns whatever ipcRenderer.invoke resolves with', async () => {
    invokeMock.mockResolvedValueOnce(5);
    const createInvoker = createIpcInvokerFactory<TestContract>();
    const invoke = createInvoker('test:add');

    await expect(invoke(2, 3)).resolves.toBe(5);
  });
});
