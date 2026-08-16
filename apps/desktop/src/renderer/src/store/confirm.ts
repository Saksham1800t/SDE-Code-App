import { create } from 'zustand';
import { ConfirmOptions, ConfirmState } from '../types/confirm';

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  currentConfirm: null,
  showConfirm: (message, options) => {
    return new Promise<boolean>((resolve) => {
      set({
        currentConfirm: {
          id: Math.random().toString(),
          message,
          resolve,
          ...options,
        },
      });
    });
  },
  resolveConfirm: (result) => {
    get().currentConfirm?.resolve(result);
    set({ currentConfirm: null });
  },
}));

// Themed, promise-based replacement for window.confirm() — doesn't block the renderer thread and follows the IDE's theme.
export const customConfirm = (message: string, options?: ConfirmOptions): Promise<boolean> =>
  useConfirmStore.getState().showConfirm(message, options);
