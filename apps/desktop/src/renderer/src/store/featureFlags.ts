import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';

export interface FeatureFlag {
  name: string;
  description: string;
  userValue: boolean;
  /** null = no workspace override — this flag inherits userValue here. */
  workspaceValue: boolean | null;
}

export type FlagScope = 'user' | 'workspace';

interface FeatureFlagsState {
  featureFlags: FeatureFlag[];
  loadFeatureFlags: () => Promise<void>;
  toggleFeatureFlag: (name: string, scope: FlagScope) => Promise<void>;
  clearWorkspaceOverride: (name: string) => Promise<void>;
  /** The value real behavior should gate on — workspace override if set, else the User value. */
  isFlagEnabled: (name: string) => boolean;
}

// Same project-identity convention as conversations/project_rules/project_memory, so a flag's workspace override lines up with the same "workspace".
function currentProjectId(): string {
  return useWorkspaceStore.getState().workspaceName || 'default_proj';
}

export const useFeatureFlagsStore = create<FeatureFlagsState>((set, get) => ({
  featureFlags: [],

  loadFeatureFlags: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const dbFlags = await api.getFlags(currentProjectId());
      set({
        featureFlags: (dbFlags || []).map((f) => ({
          name: f.name,
          description: f.description,
          userValue: f.user_enabled === 1,
          workspaceValue: f.workspace_enabled === null ? null : f.workspace_enabled === 1,
        })),
      });
    } catch (err) {
      console.error('Failed to load feature flags:', err);
    }
  },

  toggleFeatureFlag: async (name, scope) => {
    const api = window.api;
    if (!api) return;
    const flags = get().featureFlags;
    const flag = flags.find((f) => f.name === name);
    if (!flag) return;

    const current = scope === 'workspace' ? flag.workspaceValue ?? flag.userValue : flag.userValue;
    const nextVal = !current;
    try {
      await api.setFlag(name, nextVal, scope === 'workspace' ? currentProjectId() : undefined);
      const updated = flags.map((f) =>
        f.name === name
          ? scope === 'workspace'
            ? { ...f, workspaceValue: nextVal }
            : { ...f, userValue: nextVal }
          : f,
      );
      set({ featureFlags: updated });
    } catch (err) {
      console.error('Failed to update feature flag:', err);
    }
  },

  clearWorkspaceOverride: async (name) => {
    const api = window.api;
    if (!api?.clearWorkspaceFlagOverride) return;
    try {
      await api.clearWorkspaceFlagOverride(name, currentProjectId());
      set({
        featureFlags: get().featureFlags.map((f) => (f.name === name ? { ...f, workspaceValue: null } : f)),
      });
    } catch (err) {
      console.error('Failed to clear workspace flag override:', err);
    }
  },

  isFlagEnabled: (name) => {
    const flag = get().featureFlags.find((f) => f.name === name);
    if (!flag) return false;
    return flag.workspaceValue ?? flag.userValue;
  },
}));
