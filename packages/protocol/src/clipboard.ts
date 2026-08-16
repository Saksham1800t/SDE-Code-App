/** Reads the OS clipboard via Electron's main-process module, not the renderer's Async Clipboard API, which Monaco paste fails to use here. */
export type ClipboardIpcContract = {
  'clipboard:readText': () => Promise<string>;
};
