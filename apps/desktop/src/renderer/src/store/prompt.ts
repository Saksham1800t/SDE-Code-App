import { create } from 'zustand';
import { PromptOptions, PromptState } from '../types/prompt';

export const usePromptStore = create<PromptState>((set, get) => ({
  currentPrompt: null,
  showPrompt: (message, options) => {
    return new Promise<string | null>((resolve) => {
      set({
        currentPrompt: {
          id: Math.random().toString(),
          message,
          resolve,
          ...options,
        },
      });
    });
  },
  resolvePrompt: (result) => {
    get().currentPrompt?.resolve(result);
    set({ currentPrompt: null });
  },
}));

// Themed, promise-based replacement for window.prompt() — Electron throws
// "prompt() is and will not be supported" rather than showing a dialog, so
// every call site using the native one was silently broken (the click
// handler threw and the whole action appeared to do nothing).
export const customPrompt = (message: string, options?: PromptOptions): Promise<string | null> =>
  usePromptStore.getState().showPrompt(message, options);
