import { ipcMain } from 'electron';
import { IpcContract } from './ipcContract';

/** Main-process side of the typed IPC pattern; binds a registrar to one contract so a typo'd channel name or wrong-signature handler is a compile error, not a silent runtime mismatch. */
export function createIpcHandlerRegistrar<Contract extends IpcContract>() {
  return function registerHandler<K extends keyof Contract & string>(
    channel: K,
    handler: (...args: Parameters<Contract[K]>) => ReturnType<Contract[K]>,
  ): void {
    ipcMain.handle(channel, (_event, ...args) => handler(...(args as Parameters<Contract[K]>)));
  };
}
