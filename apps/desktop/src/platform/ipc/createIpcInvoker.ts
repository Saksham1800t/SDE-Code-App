import { ipcRenderer } from 'electron';
import { IpcContract } from './ipcContract';

/** Preload-side counterpart to {@link createIpcHandlerRegistrar}; binds an invoker factory to one contract, forwarding arguments to `ipcRenderer.invoke` positionally. */
export function createIpcInvokerFactory<Contract extends IpcContract>() {
  return function createInvoker<K extends keyof Contract & string>(channel: K): Contract[K] {
    return ((...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as Contract[K];
  };
}
