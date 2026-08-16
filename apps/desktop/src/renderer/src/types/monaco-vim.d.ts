declare module 'monaco-vim' {
  export interface VimMode {
    dispose(): void;
  }
  export function initVimMode(editor: unknown, statusBarNode: HTMLElement): VimMode;
}
