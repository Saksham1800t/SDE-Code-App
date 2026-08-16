import { create } from 'zustand';
import type { AgentFileChange, ImpactReport } from '@sde-code/protocol';
import { useStatusBarStore } from './statusBar';
import { useWorkspaceStore } from './workspace';
import { getProviderLabel } from '../utils/aiModels';
import { fetchImpactForFile } from '../utils/codeMapImpact';

interface AgentState {
  activeAIProvider: string;
  setActiveAIProvider: (provider: string) => void;
  activeAIModel: string;
  setActiveAIModel: (model: string) => void;
  inlineCompletionEnabled: boolean;
  setInlineCompletionEnabled: (enabled: boolean) => void;
  /** `impact` is populated asynchronously after the edit lands (see setPendingAIEdits) — undefined while still loading/unavailable, never blocks the edit itself. */
  pendingAIEdits: { filePath: string; originalContent: string; currentContent: string; impact?: ImpactReport } | null;
  setPendingAIEdits: (edits: { filePath: string; originalContent: string; currentContent: string } | null) => void;
  applyPendingAIEdits: () => void;
  discardPendingAIEdits: () => void;

  // Agent Mode's multi-file working set — keyed by filePath, separate from
  // pendingAIEdits (single-file Edit Code mode) above, which is untouched.
  agentWorkingSet: Record<string, AgentFileChange>;
  // Separate map, not a field on AgentFileChange, since that type crosses the IPC boundary and impact is a renderer-only enrichment.
  agentWorkingSetImpact: Record<string, ImpactReport>;
  setAgentWorkingSet: (changes: AgentFileChange[]) => void;
  acceptAgentFileChange: (filePath: string) => Promise<void>;
  rejectAgentFileChange: (filePath: string) => void;
  acceptAllAgentFileChanges: () => Promise<void>;
  rejectAllAgentFileChanges: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  activeAIProvider: 'gemini',
  activeAIModel: 'gemini-1.5-flash',
  inlineCompletionEnabled: true,
  pendingAIEdits: null,
  agentWorkingSet: {},
  agentWorkingSetImpact: {},

  setActiveAIProvider: (provider) => {
    set({ activeAIProvider: provider });
    useStatusBarStore.getState().updateItemText('ai-provider', getProviderLabel(provider));

    const api = window.api;
    if (api && api.setSetting) {
      api.setSetting('ide-ai-provider', provider);
    }
  },

  setActiveAIModel: (model) => {
    set({ activeAIModel: model });
    const api = window.api;
    if (api && api.setSetting) {
      api.setSetting('ide-ai-model', model);
    }
  },

  setInlineCompletionEnabled: (enabled) => {
    set({ inlineCompletionEnabled: enabled });
    const api = window.api;
    if (api && api.setSetting) {
      api.setSetting('ide-inline-completion-enabled', enabled ? '1' : '0');
    }
  },

  setPendingAIEdits: (edits) => {
    set({ pendingAIEdits: edits });
    if (!edits) return;
    // Computed once here so every renderer of pendingAIEdits sees the same impact data without duplicating the fetch.
    fetchImpactForFile(edits.filePath, useWorkspaceStore.getState().workspaceFolders).then((impact) => {
      if (!impact) return;
      // Guard against a stale response landing after the edit was
      // discarded/applied or a different file's edit superseded it.
      const current = get().pendingAIEdits;
      if (current?.filePath === edits.filePath) {
        set({ pendingAIEdits: { ...current, impact } });
      }
    });
  },

  applyPendingAIEdits: () => {
    const edits = get().pendingAIEdits;
    if (!edits) return;
    set({ pendingAIEdits: null });
    useWorkspaceStore.getState().saveTab(edits.filePath);
  },

  discardPendingAIEdits: () => {
    const edits = get().pendingAIEdits;
    if (!edits) return;
    useWorkspaceStore.getState().setTabContent(edits.filePath, edits.originalContent, false);
    set({ pendingAIEdits: null });
  },

  setAgentWorkingSet: (changes) => {
    const map: Record<string, AgentFileChange> = {};
    for (const change of changes) {
      map[change.filePath] = change;
    }
    // Clear stale impact data from any previous working set — a new set of
    // changes means the old impact reports no longer apply.
    set({ agentWorkingSet: map, agentWorkingSetImpact: {} });

    const folders = useWorkspaceStore.getState().workspaceFolders;
    changes.forEach((change) => {
      fetchImpactForFile(change.filePath, folders).then((impact) => {
        if (!impact) return;
        // Guard: only attach if this file is still part of the current
        // working set (it may have been accepted/rejected while we waited).
        if (get().agentWorkingSet[change.filePath]) {
          set({ agentWorkingSetImpact: { ...get().agentWorkingSetImpact, [change.filePath]: impact } });
        }
      });
    });
  },

  acceptAgentFileChange: async (filePath) => {
    const change = get().agentWorkingSet[filePath];
    if (!change) {
      return;
    }
    const api = window.api;
    if (!api) {
      return;
    }

    const workspace = useWorkspaceStore.getState();
    if (change.isDeleted) {
      await api.deleteFile(filePath);
      // File is already gone from disk — skip the unsaved-changes prompt, the user already approved this deletion.
      workspace.closeFile(filePath, { skipUnsavedCheck: true });
      await workspace.refreshFileTree();
    } else {
      await api.writeFile(filePath, change.proposedContent);
      // No-ops in every group that doesn't have this path open — safe to call unconditionally.
      workspace.setTabContent(filePath, change.proposedContent, false);
      if (change.isNew) {
        await workspace.refreshFileTree();
      }
    }

    const rest = { ...get().agentWorkingSet };
    delete rest[filePath];
    const restImpact = { ...get().agentWorkingSetImpact };
    delete restImpact[filePath];
    set({ agentWorkingSet: rest, agentWorkingSetImpact: restImpact });
  },

  rejectAgentFileChange: (filePath) => {
    const change = get().agentWorkingSet[filePath];
    if (!change) {
      return;
    }

    useWorkspaceStore.getState().setTabContent(filePath, change.originalContent, false);

    const rest = { ...get().agentWorkingSet };
    delete rest[filePath];
    const restImpact = { ...get().agentWorkingSetImpact };
    delete restImpact[filePath];
    set({ agentWorkingSet: rest, agentWorkingSetImpact: restImpact });
  },

  acceptAllAgentFileChanges: async () => {
    for (const filePath of Object.keys(get().agentWorkingSet)) {
      await get().acceptAgentFileChange(filePath);
    }
  },

  rejectAllAgentFileChanges: () => {
    for (const filePath of Object.keys(get().agentWorkingSet)) {
      get().rejectAgentFileChange(filePath);
    }
  },
}));
