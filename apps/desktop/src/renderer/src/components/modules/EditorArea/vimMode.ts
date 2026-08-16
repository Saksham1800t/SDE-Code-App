import { initVimMode, type VimMode } from 'monaco-vim';
import type * as monaco from 'monaco-editor';

/**
 * The real status-bar DOM node monaco-vim writes its mode text into ("-- INSERT --" etc).
 * Owned by StatusBar.tsx (registered on mount, cleared on unmount) — module-level rather than
 * threaded through props/context since it's a single shared target regardless of which split
 * pane is focused, and only ever one editor pane is "active" at a time.
 */
let statusBarNode: HTMLElement | null = null;

export function setVimStatusBarNode(node: HTMLElement | null): void {
  statusBarNode = node;
}

/**
 * Attaches monaco-vim to one editor pane. Every pane gets real Vim keybindings (each has its
 * own Monaco editor instance to intercept keystrokes on), but only the currently-active pane's
 * instance is given the real visible status-bar node — background panes write into a detached
 * element that's never attached to the document, so their mode text never becomes visible
 * (there's only one status bar, and it should always reflect the focused editor).
 */
export function attachVimMode(editor: monaco.editor.IStandaloneCodeEditor, isActive: boolean): VimMode {
  const target = isActive && statusBarNode ? statusBarNode : document.createElement('div');
  return initVimMode(editor, target);
}
