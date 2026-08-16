import { create } from 'zustand';
import { useCommandsStore } from './commands';

export type WordWrapMode = 'on' | 'off';
export type LineNumbersMode = 'on' | 'off';

interface EditorSettingsState {
  fontSize: number;
  tabSize: number;
  wordWrap: WordWrapMode;
  minimapEnabled: boolean;
  lineNumbers: LineNumbersMode;
  showBreadcrumbs: boolean;
  /** TS/JS parameter-name and inferred-type hints — off by default, matching tsserver/VS Code. See EditorArea/inlayHints.ts for why enabling this needs more than the editor's own option. */
  inlayHintsEnabled: boolean;
  /** Vim modal-editing keybindings via monaco-vim — see EditorArea/vimMode.ts for the per-pane setup/teardown this drives. */
  vimModeEnabled: boolean;

  setFontSize: (n: number) => void;
  setTabSize: (n: number) => void;
  setWordWrap: (v: WordWrapMode) => void;
  setMinimapEnabled: (v: boolean) => void;
  setLineNumbers: (v: LineNumbersMode) => void;
  setShowBreadcrumbs: (v: boolean) => void;
  setInlayHintsEnabled: (v: boolean) => void;
  setVimModeEnabled: (v: boolean) => void;
  initializeEditorSettings: () => Promise<void>;
}

export const useEditorSettingsStore = create<EditorSettingsState>((set) => ({
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'on',
  minimapEnabled: true,
  lineNumbers: 'on',
  showBreadcrumbs: true,
  inlayHintsEnabled: false,
  vimModeEnabled: false,

  setFontSize: (n) => {
    set({ fontSize: n });
    window.api?.setSetting?.('ide-editor-font-size', String(n), useCommandsStore.getState().activeProfileId);
  },
  setTabSize: (n) => {
    set({ tabSize: n });
    window.api?.setSetting?.('ide-editor-tab-size', String(n), useCommandsStore.getState().activeProfileId);
  },
  setWordWrap: (v) => {
    set({ wordWrap: v });
    window.api?.setSetting?.('ide-editor-word-wrap', v, useCommandsStore.getState().activeProfileId);
  },
  setMinimapEnabled: (v) => {
    set({ minimapEnabled: v });
    window.api?.setSetting?.('ide-editor-minimap', v ? '1' : '0', useCommandsStore.getState().activeProfileId);
  },
  setLineNumbers: (v) => {
    set({ lineNumbers: v });
    window.api?.setSetting?.('ide-editor-line-numbers', v, useCommandsStore.getState().activeProfileId);
  },
  setShowBreadcrumbs: (v) => {
    set({ showBreadcrumbs: v });
    window.api?.setSetting?.('ide-editor-breadcrumbs', v ? '1' : '0', useCommandsStore.getState().activeProfileId);
  },
  setInlayHintsEnabled: (v) => {
    set({ inlayHintsEnabled: v });
    window.api?.setSetting?.('ide-editor-inlay-hints', v ? '1' : '0', useCommandsStore.getState().activeProfileId);
  },
  setVimModeEnabled: (v) => {
    set({ vimModeEnabled: v });
    window.api?.setSetting?.('ide-editor-vim-mode', v ? '1' : '0', useCommandsStore.getState().activeProfileId);
  },

  // Re-run whenever the active profile changes so settings reflect the newly-selected profile's overrides.
  initializeEditorSettings: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const settings = await api.getSettings(useCommandsStore.getState().activeProfileId);
      const fontSize = settings?.['ide-editor-font-size'];
      const tabSize = settings?.['ide-editor-tab-size'];
      const wordWrap = settings?.['ide-editor-word-wrap'];
      const minimap = settings?.['ide-editor-minimap'];
      const lineNumbers = settings?.['ide-editor-line-numbers'];
      const breadcrumbs = settings?.['ide-editor-breadcrumbs'];
      const inlayHints = settings?.['ide-editor-inlay-hints'];
      const vimMode = settings?.['ide-editor-vim-mode'];

      set({
        fontSize: fontSize ? Number(fontSize) : 14,
        tabSize: tabSize ? Number(tabSize) : 2,
        wordWrap: wordWrap === 'off' ? 'off' : 'on',
        minimapEnabled: minimap === undefined ? true : minimap === '1',
        lineNumbers: lineNumbers === 'off' ? 'off' : 'on',
        showBreadcrumbs: breadcrumbs === undefined ? true : breadcrumbs === '1',
        inlayHintsEnabled: inlayHints === '1',
        vimModeEnabled: vimMode === '1',
      });
    } catch (err) {
      console.error('Failed to load editor settings:', err);
    }
  },
}));
