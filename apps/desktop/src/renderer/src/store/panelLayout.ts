import { create } from 'zustand';
import { useTerminalStore } from './terminal';

export type PanelPosition = 'bottom' | 'top' | 'left' | 'right';
export type PanelMaximizeRemember = 'always' | 'never' | 'remember';

interface PanelLayoutState {
  activeSidebarTab: 'explorer' | 'git' | 'assistant' | 'settings' | 'extensions' | 'search' | 'github' | 'codemap';
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  terminalHeight: number;

  /** Matches VS Code's definition: the editor area is hidden, not a fixed percentage resize. Session-only unless panelMaximizeRemember === 'remember'. */
  isPanelMaximized: boolean;
  /** Cached panel height from just before maximizing, restored on un-maximize. */
  lastNonMaximizedHeight: number;
  panelMaximizeRemember: PanelMaximizeRemember;
  /** Only functionally honored for 'bottom' this pass — see BottomPanel plan. */
  panelPosition: PanelPosition;

  /** Hides sidebar/activity bar/status bar/bottom panel, leaving just the editor — App.tsx reads this directly for the two chrome pieces (activity bar, status bar) that have no toggle state of their own. */
  isZenMode: boolean;
  /** Snapshot of what was open just before entering Zen Mode, restored on exit. Null outside Zen Mode. */
  preZenModeState: { isLeftSidebarOpen: boolean; isRightSidebarOpen: boolean; isTerminalOpen: boolean } | null;

  setSidebarTab: (tab: 'explorer' | 'git' | 'assistant' | 'settings' | 'extensions' | 'search' | 'github' | 'codemap') => void;
  toggleLeftSidebar: (forceState?: boolean) => void;
  toggleRightSidebar: (forceState?: boolean) => void;
  setLeftSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setTerminalHeight: (h: number) => void;
  togglePanelMaximized: (forceState?: boolean) => void;
  setPanelPosition: (position: PanelPosition) => void;
  toggleZenMode: (forceState?: boolean) => void;
  initializePanelLayout: () => Promise<void>;
}

export const usePanelLayoutStore = create<PanelLayoutState>((set, get) => ({
  activeSidebarTab: 'explorer',
  isLeftSidebarOpen: true,
  isRightSidebarOpen: false,
  leftSidebarWidth: 260,
  rightSidebarWidth: 320,
  terminalHeight: 240,
  isPanelMaximized: false,
  lastNonMaximizedHeight: 300,
  panelMaximizeRemember: 'never',
  panelPosition: 'bottom',
  isZenMode: false,
  preZenModeState: null,

  setSidebarTab: (tab) => set({ activeSidebarTab: tab }),

  toggleLeftSidebar: (forceState) => {
    const nextState = forceState !== undefined ? forceState : !get().isLeftSidebarOpen;
    set({ isLeftSidebarOpen: nextState });
  },

  toggleRightSidebar: (forceState) => {
    const nextState = forceState !== undefined ? forceState : !get().isRightSidebarOpen;
    set({ isRightSidebarOpen: nextState });
  },

  setLeftSidebarWidth: (w) => set({ leftSidebarWidth: w }),
  setRightSidebarWidth: (w) => set({ rightSidebarWidth: w }),

  setTerminalHeight: (h) => {
    set({ terminalHeight: h });
    window.api?.setSetting?.('ide-panel-height', String(h));
  },

  togglePanelMaximized: (forceState) => {
    const next = forceState !== undefined ? forceState : !get().isPanelMaximized;
    if (next) {
      const currentHeight = get().terminalHeight;
      set({ lastNonMaximizedHeight: currentHeight, isPanelMaximized: true });
      window.api?.setSetting?.('ide-panel-last-height', String(currentHeight));
    } else {
      set({ terminalHeight: get().lastNonMaximizedHeight, isPanelMaximized: false });
    }
    if (get().panelMaximizeRemember === 'remember') {
      window.api?.setSetting?.('ide-panel-was-maximized', next ? '1' : '0');
    }
  },

  setPanelPosition: (position) => {
    set({ panelPosition: position });
    window.api?.setSetting?.('ide-panel-position', position);
  },

  toggleZenMode: (forceState) => {
    const next = forceState !== undefined ? forceState : !get().isZenMode;
    if (next === get().isZenMode) return;

    if (next) {
      // Entering — snapshot what's open, then hide everything (bottom panel lives in useTerminalStore, hence the cross-store call).
      const isTerminalOpen = useTerminalStore.getState().isTerminalOpen;
      set({
        preZenModeState: { isLeftSidebarOpen: get().isLeftSidebarOpen, isRightSidebarOpen: get().isRightSidebarOpen, isTerminalOpen },
        isLeftSidebarOpen: false,
        isRightSidebarOpen: false,
        isZenMode: true,
      });
      if (isTerminalOpen) useTerminalStore.getState().toggleTerminalPanel(false);
    } else {
      // Exiting — restore exactly what was open before, not just "open everything".
      const prior = get().preZenModeState;
      set({
        isLeftSidebarOpen: prior?.isLeftSidebarOpen ?? true,
        isRightSidebarOpen: prior?.isRightSidebarOpen ?? false,
        isZenMode: false,
        preZenModeState: null,
      });
      if (prior?.isTerminalOpen) useTerminalStore.getState().toggleTerminalPanel(true);
    }
  },

  initializePanelLayout: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const settings = await api.getSettings();
      const height = settings?.['ide-panel-height'];
      const lastHeight = settings?.['ide-panel-last-height'];
      const remember = settings?.['ide-panel-maximize-remember'];
      const position = settings?.['ide-panel-position'];
      const wasMaximized = settings?.['ide-panel-was-maximized'];

      const parsedRemember: PanelMaximizeRemember =
        remember === 'always' || remember === 'remember' ? remember : 'never';
      // Only 'bottom' is functionally supported this pass — any other stored value falls back rather than risking an unsupported layout.
      const parsedPosition: PanelPosition = position === 'bottom' ? 'bottom' : 'bottom';

      set({
        terminalHeight: height ? Number(height) : get().terminalHeight,
        lastNonMaximizedHeight: lastHeight ? Number(lastHeight) : get().lastNonMaximizedHeight,
        panelMaximizeRemember: parsedRemember,
        panelPosition: parsedPosition,
      });

      const shouldStartMaximized = parsedRemember === 'always' || (parsedRemember === 'remember' && wasMaximized === '1');
      if (shouldStartMaximized) {
        // Deliberately not calling togglePanelMaximized(true): it would cache the just-persisted (possibly stale) terminalHeight, clobbering lastNonMaximizedHeight restored above.
        set({ isPanelMaximized: true });
      }
    } catch (err) {
      console.error('Failed to load panel layout settings:', err);
    }
  },
}));
