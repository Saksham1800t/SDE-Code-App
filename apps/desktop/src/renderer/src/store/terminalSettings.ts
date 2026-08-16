import { create } from 'zustand';
import { useCommandsStore } from './commands';

export type TerminalCursorStyle = 'block' | 'underline' | 'bar';

interface TerminalSettingsState {
  fontSize: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  scrollback: number;

  setFontSize: (n: number) => void;
  setCursorStyle: (v: TerminalCursorStyle) => void;
  setCursorBlink: (v: boolean) => void;
  setScrollback: (n: number) => void;
  initializeTerminalSettings: () => Promise<void>;
}

const VALID_CURSOR_STYLES: TerminalCursorStyle[] = ['block', 'underline', 'bar'];

export const useTerminalSettingsStore = create<TerminalSettingsState>((set) => ({
  fontSize: 14,
  cursorStyle: 'block',
  cursorBlink: false,
  scrollback: 1000,

  setFontSize: (n) => {
    set({ fontSize: n });
    window.api?.setSetting?.('ide-terminal-font-size', String(n), useCommandsStore.getState().activeProfileId);
  },
  setCursorStyle: (v) => {
    set({ cursorStyle: v });
    window.api?.setSetting?.('ide-terminal-cursor-style', v, useCommandsStore.getState().activeProfileId);
  },
  setCursorBlink: (v) => {
    set({ cursorBlink: v });
    window.api?.setSetting?.('ide-terminal-cursor-blink', v ? '1' : '0', useCommandsStore.getState().activeProfileId);
  },
  setScrollback: (n) => {
    set({ scrollback: n });
    window.api?.setSetting?.('ide-terminal-scrollback', String(n), useCommandsStore.getState().activeProfileId);
  },

  initializeTerminalSettings: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const settings = await api.getSettings(useCommandsStore.getState().activeProfileId);
      const fontSize = settings?.['ide-terminal-font-size'];
      const cursorStyle = settings?.['ide-terminal-cursor-style'];
      const cursorBlink = settings?.['ide-terminal-cursor-blink'];
      const scrollback = settings?.['ide-terminal-scrollback'];

      set({
        fontSize: fontSize ? Number(fontSize) : 14,
        cursorStyle: VALID_CURSOR_STYLES.includes(cursorStyle as TerminalCursorStyle) ? (cursorStyle as TerminalCursorStyle) : 'block',
        cursorBlink: cursorBlink === '1',
        scrollback: scrollback ? Number(scrollback) : 1000,
      });
    } catch (err) {
      console.error('Failed to load terminal settings:', err);
    }
  },
}));
