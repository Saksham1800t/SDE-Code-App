import { create } from 'zustand';

export interface StatusBarItem {
  id: string;
  text: string;
  icon?: string; // name or simple character
  tooltip?: string;
  priority: number; // higher priority renders first
  alignment: 'left' | 'right';
  visible: boolean;
  source: 'core' | 'official' | 'extension';
  commandId?: string;
}

interface StatusBarState {
  items: StatusBarItem[];

  // Actions
  initialize: () => Promise<void>;
  registerItem: (item: Omit<StatusBarItem, 'visible'>) => void;
  updateItemText: (id: string, text: string) => void;
  updateItemTooltip: (id: string, tooltip: string) => void;
  toggleItemVisibility: (id: string) => Promise<void>;
  reorderItems: (orderedIds: string[]) => void;
}

export const useStatusBarStore = create<StatusBarState>((set, get) => ({
  items: [],

  initialize: async () => {
    const api = window.api;
    if (!api) return;

    try {
      const defaultItems: StatusBarItem[] = [
        { id: 'workspace-trust', text: 'Restricted Mode', icon: 'shield-alert', tooltip: 'This folder is not trusted — click to trust it and enable Agent Mode file edits/terminal commands', priority: 1050, alignment: 'left', visible: true, source: 'core', commandId: 'workspace.trustFolder' },
        { id: 'git-branch', text: 'main', icon: 'git-branch', tooltip: 'Active Git Branch', priority: 1000, alignment: 'left', visible: true, source: 'core', commandId: 'git.checkout' },
        { id: 'problems', text: '0 errors, 0 warnings', icon: '', tooltip: 'Problems in workspace', priority: 950, alignment: 'left', visible: true, source: 'core', commandId: 'workbench.action.showErrors' },
        { id: 'project-indexer', text: 'Indexing: Ready', icon: 'zap', tooltip: 'SQLite Index Status', priority: 900, alignment: 'left', visible: true, source: 'official', commandId: 'project.rebuildIndex' },
        { id: 'ai-provider', text: 'Gemini', icon: 'bot', tooltip: 'AI Assistant Provider', priority: 850, alignment: 'right', visible: true, source: 'official', commandId: 'ai.switchProvider' },
        { id: 'cursor-pos', text: 'Ln 1, Col 1', icon: '', tooltip: 'Cursor Position', priority: 800, alignment: 'right', visible: true, source: 'core' },
        { id: 'indentation', text: 'Spaces: 2', icon: '', tooltip: 'Editor Indentation', priority: 750, alignment: 'right', visible: true, source: 'core' },
        { id: 'language-mode', text: 'TypeScript', icon: '', tooltip: 'Select Language Mode', priority: 700, alignment: 'right', visible: true, source: 'core' },
        { id: 'cloud-sync', text: 'Synced', icon: 'cloud', tooltip: 'Cloud Sync Status', priority: 650, alignment: 'right', visible: true, source: 'official' }
      ];

      // Merge with any custom items registered by extensions already in the state
      const currentItems = get().items;
      const merged = [...defaultItems];

      // Add any extension items already in runtime state that are not in default list
      currentItems.forEach(item => {
        if (!merged.some(m => m.id === item.id)) {
          merged.push(item);
        }
      });

      // Real extension-contributed items, fetched from the extension-host registry (unlike the runtime-state merge above, which only re-adds known items).
      if (api.getExtensionStatusBarItems) {
        try {
          const extensionItems = await api.getExtensionStatusBarItems();
          extensionItems.forEach((item: { id: string; extensionId: string; options: any }) => {
            if (merged.some((m) => m.id === item.id)) return;
            merged.push({
              id: item.id,
              text: item.options.text,
              icon: item.options.icon,
              tooltip: item.options.tooltip,
              priority: item.options.priority ?? 500,
              alignment: item.options.alignment ?? 'left',
              visible: true,
              source: 'extension',
              commandId: item.options.commandId,
            });
          });
        } catch (err) {
          console.error('Failed to load extension status bar items:', err);
        }
      }

      set({ items: merged });
    } catch (err) {
      console.error('Failed to initialize status bar store:', err);
    }
  },

  registerItem: (item) => {
    const current = get().items;
    const exists = current.some(i => i.id === item.id);
    if (exists) {
      const updated = current.map(i => i.id === item.id ? { ...i, ...item } : i);
      set({ items: updated });
    } else {
      set({ items: [...current, { ...item, visible: true }] });
    }
  },

  updateItemText: (id, text) => {
    const updated = get().items.map(i => i.id === id ? { ...i, text } : i);
    set({ items: updated });
  },

  updateItemTooltip: (id, tooltip) => {
    const updated = get().items.map(i => i.id === id ? { ...i, tooltip } : i);
    set({ items: updated });
  },

  toggleItemVisibility: async (id) => {
    const updated = get().items.map(i => i.id === id ? { ...i, visible: !i.visible } : i);
    set({ items: updated });
  },

  reorderItems: (orderedIds) => {
    const items = get().items;
    const updated = items.map(item => {
      const idx = orderedIds.indexOf(item.id);
      if (idx !== -1) {
        // Adjust priority (invert index so early items have higher priority)
        return { ...item, priority: 1000 - idx };
      }
      return item;
    });
    set({ items: updated });
  }
}));
