import { create } from 'zustand';
import type { MultibufferExcerptSource } from '../utils/multibuffer';

/**
 * Excerpt sources per multibuffer tab, keyed by tab path — kept off the tab
 * object itself, same reasoning as store/bulkRename.ts: this data is
 * specific to one synthetic view, not part of the generic tab shape every
 * other EditorTab consumer has to know about.
 */
interface MultibufferState {
  excerptSources: Record<string, MultibufferExcerptSource[]>;
  registerMultibuffer: (tabPath: string, excerpts: MultibufferExcerptSource[]) => void;
  getExcerptSources: (tabPath: string) => MultibufferExcerptSource[];
  clearMultibuffer: (tabPath: string) => void;
}

export const useMultibufferStore = create<MultibufferState>((set, get) => ({
  excerptSources: {},

  registerMultibuffer: (tabPath, excerpts) => {
    set((state) => ({ excerptSources: { ...state.excerptSources, [tabPath]: excerpts } }));
  },

  getExcerptSources: (tabPath) => get().excerptSources[tabPath] ?? [],

  clearMultibuffer: (tabPath) => {
    set((state) => {
      const { [tabPath]: _removed, ...rest } = state.excerptSources;
      return { excerptSources: rest };
    });
  },
}));
