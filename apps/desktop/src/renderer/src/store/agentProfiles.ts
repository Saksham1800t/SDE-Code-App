import { create } from 'zustand';
import {
  AGENT_POLICY_TOOL_NAMES,
  AGENT_PROFILE_PRESETS,
  DEFAULT_AGENT_TOOL_POLICIES,
  type AgentPolicyToolName,
  type AgentToolPolicy,
} from '@sde-code/protocol';

export type AgentProfilePreset = 'read-only' | 'full-access' | 'custom';

const SETTING_KEY = 'ide-agent-tool-policies';

function detectPreset(policies: Record<AgentPolicyToolName, AgentToolPolicy>): AgentProfilePreset {
  const matchesPreset = (preset: Record<AgentPolicyToolName, AgentToolPolicy>) =>
    AGENT_POLICY_TOOL_NAMES.every((name) => policies[name] === preset[name]);
  if (matchesPreset(AGENT_PROFILE_PRESETS['read-only'])) return 'read-only';
  if (matchesPreset(AGENT_PROFILE_PRESETS['full-access'])) return 'full-access';
  return 'custom';
}

interface AgentProfilesState {
  toolPolicies: Record<AgentPolicyToolName, AgentToolPolicy>;
  activePreset: AgentProfilePreset;
  initialize: () => Promise<void>;
  applyPreset: (preset: 'read-only' | 'full-access') => void;
  setToolPolicy: (tool: AgentPolicyToolName, policy: AgentToolPolicy) => void;
}

/** Persists the whole map under one JSON setting, same convention as ide-theme/ide-editor-*; read back by AiService (main process) via databaseService.getSettings() at query time — see aiService.ts's agentQuery(). */
export const useAgentProfilesStore = create<AgentProfilesState>((set, get) => ({
  toolPolicies: DEFAULT_AGENT_TOOL_POLICIES,
  activePreset: detectPreset(DEFAULT_AGENT_TOOL_POLICIES),

  initialize: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const settings = await api.getSettings();
      const raw = settings?.[SETTING_KEY];
      const policies = raw ? { ...DEFAULT_AGENT_TOOL_POLICIES, ...JSON.parse(raw) } : DEFAULT_AGENT_TOOL_POLICIES;
      set({ toolPolicies: policies, activePreset: detectPreset(policies) });
    } catch (err) {
      console.error('Failed to load Agent Profile tool policies:', err);
    }
  },

  applyPreset: (preset) => {
    const policies = { ...AGENT_PROFILE_PRESETS[preset] };
    set({ toolPolicies: policies, activePreset: preset });
    window.api?.setSetting?.(SETTING_KEY, JSON.stringify(policies));
  },

  setToolPolicy: (tool, policy) => {
    const policies = { ...get().toolPolicies, [tool]: policy };
    set({ toolPolicies: policies, activePreset: detectPreset(policies) });
    window.api?.setSetting?.(SETTING_KEY, JSON.stringify(policies));
  },
}));
