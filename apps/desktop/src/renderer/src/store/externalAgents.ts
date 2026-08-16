import { create } from 'zustand';
import type { ExternalAgentConfig } from '@sde-code/protocol';

interface ExternalAgentsState {
  configs: ExternalAgentConfig[];
  loading: boolean;
  loadConfigs: () => Promise<void>;
  saveConfig: (config: ExternalAgentConfig) => Promise<boolean>;
  deleteConfig: (id: string) => Promise<boolean>;
}

/** CRUD only — actually running a configured agent lives in AssistantPanel.tsx alongside queryAI/queryAgent, since it's tightly coupled to that panel's own chat-transcript state, not shared app state. */
export const useExternalAgentsStore = create<ExternalAgentsState>((set, get) => ({
  configs: [],
  loading: false,

  loadConfigs: async () => {
    const api = window.api;
    if (!api?.externalAgentGetConfigs) return;
    set({ loading: true });
    try {
      const configs = await api.externalAgentGetConfigs();
      set({ configs });
    } finally {
      set({ loading: false });
    }
  },

  saveConfig: async (config) => {
    const api = window.api;
    if (!api?.externalAgentSaveConfig) return false;
    const ok = await api.externalAgentSaveConfig(config);
    if (ok) await get().loadConfigs();
    return ok;
  },

  deleteConfig: async (id) => {
    const api = window.api;
    if (!api?.externalAgentDeleteConfig) return false;
    const ok = await api.externalAgentDeleteConfig(id);
    if (ok) await get().loadConfigs();
    return ok;
  },
}));
