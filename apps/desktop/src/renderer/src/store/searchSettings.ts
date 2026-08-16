import { create } from 'zustand';

interface SearchSettingsState {
  includeGlob: string;
  excludeGlob: string;
  setIncludeGlob: (v: string) => void;
  setExcludeGlob: (v: string) => void;
  initializeSearchSettings: () => Promise<void>;
}

export const useSearchSettingsStore = create<SearchSettingsState>((set) => ({
  includeGlob: '',
  excludeGlob: '',

  setIncludeGlob: (v) => {
    set({ includeGlob: v });
    window.api?.setSetting?.('ide-search-include-glob', v);
  },
  setExcludeGlob: (v) => {
    set({ excludeGlob: v });
    window.api?.setSetting?.('ide-search-exclude-glob', v);
  },

  initializeSearchSettings: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const settings = await api.getSettings();
      set({
        includeGlob: settings?.['ide-search-include-glob'] ?? '',
        excludeGlob: settings?.['ide-search-exclude-glob'] ?? '',
      });
    } catch (err) {
      console.error('Failed to load search settings:', err);
    }
  },
}));
