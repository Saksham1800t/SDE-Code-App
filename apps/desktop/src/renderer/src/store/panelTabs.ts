import { create } from 'zustand';
import { getPanelTabRegistry } from '../panel/panelTabRegistry';

interface PanelTabsState {
  /** Ids currently visible, in user order. Ids absent here fall back to registry default order, appended at the end. */
  order: string[];
  /** Ids explicitly hidden by the user. */
  hiddenIds: string[];
  hiddenBadgeIds: string[];
  showLabels: boolean;
  showIcons: boolean;
  initialized: boolean;

  initializePanelTabs: () => Promise<void>;
  toggleTabHidden: (id: string) => void;
  toggleTabBadge: (id: string) => void;
  reorderTabs: (newOrder: string[]) => void;
  setShowLabels: (v: boolean) => void;
  setShowIcons: (v: boolean) => void;
  getVisibleOrderedTabIds: () => string[];
}

const parseJsonArray = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const usePanelTabsStore = create<PanelTabsState>((set, get) => ({
  order: [],
  hiddenIds: [],
  hiddenBadgeIds: [],
  showLabels: true,
  showIcons: true,
  initialized: false,

  initializePanelTabs: async () => {
    const api = window.api;
    let order: string[] = [];
    let hiddenIds: string[] = [];
    let hiddenBadgeIds: string[] = [];
    let showLabels = true;
    let showIcons = true;
    if (api) {
      try {
        const settings = await api.getSettings();
        order = parseJsonArray(settings?.['ide-panel-tab-order']);
        hiddenIds = parseJsonArray(settings?.['ide-panel-tab-hidden']);
        hiddenBadgeIds = parseJsonArray(settings?.['ide-panel-tab-badge-hidden']);
        if (settings?.['ide-panel-show-labels'] !== undefined) showLabels = settings['ide-panel-show-labels'] !== '0';
        if (settings?.['ide-panel-show-icons'] !== undefined) showIcons = settings['ide-panel-show-icons'] !== '0';
      } catch (err) {
        console.error('Failed to load panel tab layout settings:', err);
      }
    }
    set({ order, hiddenIds, hiddenBadgeIds, showLabels, showIcons, initialized: true });
  },

  toggleTabHidden: (id) => {
    const { hiddenIds } = get();
    const visibleCount = getPanelTabRegistry().length - hiddenIds.length;
    const isHiding = !hiddenIds.includes(id);
    // Never hide the last visible tab — mirrors VS Code's disabled "Hide" on the last pinned view.
    if (isHiding && visibleCount <= 1) return;
    const next = isHiding ? [...hiddenIds, id] : hiddenIds.filter((h) => h !== id);
    set({ hiddenIds: next });
    window.api?.setSetting?.('ide-panel-tab-hidden', JSON.stringify(next));
  },

  toggleTabBadge: (id) => {
    const { hiddenBadgeIds } = get();
    const next = hiddenBadgeIds.includes(id) ? hiddenBadgeIds.filter((h) => h !== id) : [...hiddenBadgeIds, id];
    set({ hiddenBadgeIds: next });
    window.api?.setSetting?.('ide-panel-tab-badge-hidden', JSON.stringify(next));
  },

  reorderTabs: (newOrder) => {
    set({ order: newOrder });
    window.api?.setSetting?.('ide-panel-tab-order', JSON.stringify(newOrder));
  },

  setShowLabels: (v) => {
    set({ showLabels: v });
    window.api?.setSetting?.('ide-panel-show-labels', v ? '1' : '0');
  },

  setShowIcons: (v) => {
    set({ showIcons: v });
    window.api?.setSetting?.('ide-panel-show-icons', v ? '1' : '0');
  },

  getVisibleOrderedTabIds: () => {
    const { order, hiddenIds } = get();
    const registryIds = getPanelTabRegistry()
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((t) => t.id);
    // Layer persisted order over registry default order: known entries first (handles a removed tab), then any new registry ids appended in registry order.
    const known = order.filter((id) => registryIds.includes(id));
    const unknown = registryIds.filter((id) => !known.includes(id));
    return [...known, ...unknown].filter((id) => !hiddenIds.includes(id));
  },
}));
