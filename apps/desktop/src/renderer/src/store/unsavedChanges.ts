import { create } from 'zustand';

export type UnsavedChangesResult = 'save' | 'discard' | 'cancel';

interface UnsavedChangesRequest {
  id: string;
  fileName: string;
  resolve: (result: UnsavedChangesResult) => void;
}

interface UnsavedChangesState {
  currentRequest: UnsavedChangesRequest | null;
  showUnsavedChangesPrompt: (fileName: string) => Promise<UnsavedChangesResult>;
  resolveUnsavedChangesPrompt: (result: UnsavedChangesResult) => void;
}

export const useUnsavedChangesStore = create<UnsavedChangesState>((set, get) => ({
  currentRequest: null,
  showUnsavedChangesPrompt: (fileName) => {
    return new Promise<UnsavedChangesResult>((resolve) => {
      set({ currentRequest: { id: Math.random().toString(36), fileName, resolve } });
    });
  },
  resolveUnsavedChangesPrompt: (result) => {
    get().currentRequest?.resolve(result);
    set({ currentRequest: null });
  },
}));

/** Promise-based "Save changes to X?" prompt before closing a dirty tab — its own store rather than a third outcome retrofitted onto useConfirmStore's boolean-only contract. */
export const promptUnsavedChanges = (fileName: string): Promise<UnsavedChangesResult> =>
  useUnsavedChangesStore.getState().showUnsavedChangesPrompt(fileName);
