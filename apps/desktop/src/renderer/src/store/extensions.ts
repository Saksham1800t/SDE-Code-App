import { create } from 'zustand';
import { useAgentStore } from './agent';
import { useWorkspaceStore } from './workspace';
import { useCommandsStore } from './commands';

function currentProjectId(): string {
  return useWorkspaceStore.getState().workspaceName || 'default_proj';
}

export interface Extension {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  type: 'core' | 'system' | 'marketplace';
  isEnabled: boolean;
  provides: string[]; // e.g., ["ai-provider", "git-provider", "theme"]
  dependsOn?: string[]; // e.g., ["ai-chat"]
  categories?: string[];
  tags?: string[];
  manifestJson?: string;
}

interface ExtensionsState {
  extensions: Extension[];
  loading: boolean;
  /** Per-workspace enable/disable overlay — id -> effective override, when one exists for the current workspace. */
  workspaceOverrides: Record<string, boolean>;

  // Actions
  initialize: () => Promise<void>;
  toggleExtension: (id: string, enable: boolean) => Promise<{ success: boolean; message?: string }>;
  installExtension: (ext: Omit<Extension, 'isEnabled'>) => Promise<void>;
  uninstallExtension: (id: string) => Promise<{ success: boolean; message?: string }>;
  /** True workspace-effective state: the override if this workspace has one, else the extension's global isEnabled. */
  isEffectivelyEnabled: (id: string) => boolean;
  /** Sets/flips a workspace-scoped override — never touches the extension's global isEnabled. */
  toggleWorkspaceOverride: (id: string) => Promise<void>;
  clearWorkspaceOverride: (id: string) => Promise<void>;
}

export const useExtensionsStore = create<ExtensionsState>((set, get) => ({
  extensions: [],
  loading: false,
  workspaceOverrides: {},

  initialize: async () => {
    const api = window.api;
    if (!api || !api.getExtensions) return;

    try {
      set({ loading: true });
      const defaultExtensions: Extension[] = [
        { id: 'core.explorer', name: 'File Explorer', version: '1.0.0', description: 'Core file system tree navigation.', publisher: 'SDE Core Team', type: 'core', isEnabled: true, provides: ['explorer'] },
        { id: 'core.editor', name: 'Code Editor', version: '1.0.0', description: 'Monaco-based editor workspace.', publisher: 'SDE Core Team', type: 'core', isEnabled: true, provides: ['editor'] },
        { id: 'core.terminal', name: 'Terminal Emulator', version: '1.0.0', description: 'Pty terminal workspace integration.', publisher: 'SDE Core Team', type: 'core', isEnabled: true, provides: ['terminal'] },
        { id: 'core.settings', name: 'Settings Manager', version: '1.0.0', description: 'Control preferences and keybinds.', publisher: 'SDE Core Team', type: 'core', isEnabled: true, provides: ['settings'] },
        { id: 'core.extmanager', name: 'Extension Manager', version: '1.0.0', description: 'Install, review, and toggle extensions.', publisher: 'SDE Core Team', type: 'core', isEnabled: true, provides: ['extension-manager'] },

        { id: 'sys.git', name: 'Git Integration', version: '1.0.0', description: 'Git version control and diff visualizer.', publisher: 'SDE Official', type: 'system', isEnabled: true, provides: ['git-provider'] },
        { id: 'sys.gemini', name: 'Gemini AI Provider', version: '1.0.0', description: 'Google Gemini integration.', publisher: 'SDE Official', type: 'system', isEnabled: true, provides: ['ai-provider'] },
        { id: 'sys.openai', name: 'OpenAI AI Provider', version: '1.0.0', description: 'GPT-4o model integration.', publisher: 'SDE Official', type: 'system', isEnabled: true, provides: ['ai-provider'] },
        { id: 'sys.claude', name: 'Claude AI Provider', version: '1.0.0', description: 'Anthropic Claude model integration.', publisher: 'SDE Official', type: 'system', isEnabled: true, provides: ['ai-provider'] },
        { id: 'sys.commandcenter', name: 'Command Center', version: '1.0.0', description: 'Quick access palette dialog overlay.', publisher: 'SDE Official', type: 'system', isEnabled: true, provides: ['command-center'] },
        { id: 'sys.markdown', name: 'Markdown Previewer', version: '1.0.0', description: 'Realtime markdown markup preview.', publisher: 'SDE Official', type: 'system', isEnabled: true, provides: ['editor-preview'] }
      ];

      const stored: any[] = await api.getExtensions(useCommandsStore.getState().activeProfileId);
      const list: Extension[] = stored.map((r: any): Extension => ({
        id: r.id,
        name: r.name,
        version: r.version,
        description: r.description,
        publisher: r.publisher,
        type: r.source_type as any,
        isEnabled: r.is_enabled === 1,
        provides: typeof r.provides === 'string' ? JSON.parse(r.provides) : r.provides || [],
        dependsOn: typeof r.depends_on === 'string' ? JSON.parse(r.depends_on) : r.depends_on || [],
        categories: typeof r.categories === 'string' ? JSON.parse(r.categories || '[]') : r.categories || [],
        tags: typeof r.tags === 'string' ? JSON.parse(r.tags || '[]') : r.tags || [],
        manifestJson: r.manifest_json || ''
      }));

      // Merge defaults if missing
      const missing = defaultExtensions.filter(def => !list.some(storedExt => storedExt.id === def.id));
      if (missing.length > 0) {
        for (const ext of missing) {
          await api.saveExtension(ext);
          list.push(ext);
        }
      }

      set({ extensions: list });

      if (api.getWorkspaceExtensionOverrides) {
        try {
          const overrides = await api.getWorkspaceExtensionOverrides(currentProjectId());
          set({ workspaceOverrides: overrides || {} });
        } catch (err) {
          console.error('Failed to load workspace extension overrides:', err);
        }
      }
    } catch (err) {
      console.error('Failed to load extensions:', err);
    } finally {
      set({ loading: false });
    }
  },

  toggleExtension: async (id, enable) => {
    const api = window.api;
    const list = get().extensions;
    const ext = list.find(e => e.id === id);
    if (!ext) return { success: false, message: 'Extension not found.' };

    if (ext.type === 'core') {
      return { success: false, message: 'Core Extensions are immutable and cannot be disabled.' };
    }

    if (!enable) {
      const dependent = list.find(e => e.isEnabled && e.dependsOn?.includes(id));
      if (dependent) {
        return {
          success: false,
          message: `Cannot disable "${ext.name}" because "${dependent.name}" depends on it.`
        };
      }

      // Safe Fallback Resolution for AI Providers
      if (ext.provides.includes('ai-provider')) {
        const agentStore = useAgentStore.getState();
        const activeProvider = agentStore.activeAIProvider;

        const isCurrentActive =
          (id === 'sys.gemini' && activeProvider === 'gemini') ||
          (id === 'sys.openai' && activeProvider === 'openai') ||
          (id === 'sys.claude' && activeProvider === 'anthropic');

        if (isCurrentActive) {
          const alternatives = list.filter(
            e => e.id !== id && e.isEnabled && e.provides.includes('ai-provider')
          );

          if (alternatives.length > 0) {
            const next = alternatives[0];
            let nextProviderKey = 'gemini';
            if (next.id === 'sys.openai') nextProviderKey = 'openai';
            else if (next.id === 'sys.claude') nextProviderKey = 'anthropic';

            agentStore.setActiveAIProvider(nextProviderKey);

             const updated = list.map(e => e.id === id ? { ...e, isEnabled: false } : e);
             set({ extensions: updated });
             if (api && api.setExtensionEnabled) {
               await api.setExtensionEnabled(id, false, useCommandsStore.getState().activeProfileId);
             }
             
             return {
               success: true,
               message: `Disabled ${ext.name}. Automatically swapped active AI Provider to "${next.name}".`
             };
           } else {
             return {
               success: false,
               message: `Cannot disable ${ext.name}. No other enabled AI Provider is available to fallback to. Please enable OpenAI or Claude first.`
             };
           }
         }
       }
     }
 
     const updated = list.map(e => e.id === id ? { ...e, isEnabled: enable } : e);
     set({ extensions: updated });
     if (api && api.setExtensionEnabled) {
       await api.setExtensionEnabled(id, enable, useCommandsStore.getState().activeProfileId);
     }
     return { success: true };
   },
 
   installExtension: async (ext) => {
     const list = get().extensions;
     const newExt: Extension = {
       ...ext,
       isEnabled: true
     };
     set({ extensions: [...list, newExt] });
     const api = window.api;
     if (api && api.saveExtension) {
       await api.saveExtension(newExt);
     }
   },
 
   uninstallExtension: async (id) => {
     const list = get().extensions;
     const ext = list.find(e => e.id === id);
     if (!ext) return { success: false, message: 'Extension not found.' };
 
     if (ext.type === 'core') {
       return { success: false, message: 'Core Extensions are immutable and cannot be uninstalled.' };
     }
 
     const dependent = list.find(e => e.isEnabled && e.dependsOn?.includes(id));
     if (dependent) {
       return {
         success: false,
         message: `Cannot uninstall "${ext.name}" because "${dependent.name}" depends on it.`
       };
     }
 
     const filtered = list.filter(e => e.id !== id);
     set({ extensions: filtered });
     const api = window.api;
     if (api && api.deleteExtension) {
       await api.deleteExtension(id);
     }
     return { success: true };
   },

   isEffectivelyEnabled: (id) => {
     const override = get().workspaceOverrides[id];
     if (override !== undefined) return override;
     return get().extensions.find(e => e.id === id)?.isEnabled ?? false;
   },

   toggleWorkspaceOverride: async (id) => {
     const api = window.api;
     if (!api?.setWorkspaceExtensionEnabled) return;
     const next = !get().isEffectivelyEnabled(id);
     const projectId = currentProjectId();
     set({ workspaceOverrides: { ...get().workspaceOverrides, [id]: next } });
     try {
       await api.setWorkspaceExtensionEnabled(id, projectId, next);
     } catch (err) {
       console.error('Failed to set workspace extension override:', err);
     }
   },

   clearWorkspaceOverride: async (id) => {
     const api = window.api;
     if (!api?.clearWorkspaceExtensionOverride) return;
     const projectId = currentProjectId();
     const next = { ...get().workspaceOverrides };
     delete next[id];
     set({ workspaceOverrides: next });
     try {
       await api.clearWorkspaceExtensionOverride(id, projectId);
     } catch (err) {
       console.error('Failed to clear workspace extension override:', err);
     }
   },
 }));
