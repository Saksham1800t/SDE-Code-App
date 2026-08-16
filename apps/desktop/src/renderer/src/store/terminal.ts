import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';
import { usePanelTabsStore } from './panelTabs';
import { useToolchainStore } from './toolchain';

export type BottomPanelTab = 'terminal' | 'ports' | 'problems' | 'impact-report';

interface TerminalState {
  isTerminalOpen: boolean;
  terminals: Array<{ id: string; name: string }>;
  activeTerminalId: string | null;
  /** Lifted out of BottomPanel.tsx's local state so other places (e.g. the status bar's "problems" command) can switch tabs from outside that component. */
  activeBottomTab: BottomPanelTab;
  /** Monotonically increasing, never reused — see createNewTerminal's comment for why terminals.length can't derive the next number. */
  nextTerminalNumber: number;

  toggleTerminalPanel: (forceState?: boolean) => void;
  setActiveBottomTab: (tab: BottomPanelTab) => void;
  /** Shared "auto-show" helper: makes the panel visible and switches to this tab, un-hiding it first if needed. Prefer this over composing the two actions yourself. */
  openPanelTab: (tabId: string) => void;
  createNewTerminal: (cwd?: string) => void;
  closeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  renameTerminal: (id: string, name: string) => void;
  /** Closes every open terminal session — extracted so workspace.ts's setWorkspace() can call it as an action rather than reaching into raw state. */
  closeAllTerminals: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isTerminalOpen: false,
  terminals: [],
  activeTerminalId: null,
  activeBottomTab: 'terminal',
  nextTerminalNumber: 1,

  toggleTerminalPanel: (forceState) => {
    const nextState = forceState !== undefined ? forceState : !get().isTerminalOpen;
    set({ isTerminalOpen: nextState });
  },

  setActiveBottomTab: (tab) => {
    set({ activeBottomTab: tab });
  },

  openPanelTab: (tabId) => {
    const { hiddenIds } = usePanelTabsStore.getState();
    if (hiddenIds.includes(tabId)) {
      usePanelTabsStore.getState().toggleTabHidden(tabId);
    }
    set({ isTerminalOpen: true, activeBottomTab: tabId as BottomPanelTab });
    if (tabId === 'terminal') {
      // Same refit BottomPanel's own terminal-tab click does — the container was display:none, so any fit while hidden needs redoing now.
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
  },

  createNewTerminal: (cwd) => {
    const api = window.api;
    if (!api) return;
    const nextId = 'term_' + Math.random().toString(36).substring(2, 11);
    // terminals.length + 1 would collide after a close (e.g. closing "1" from [1..5] then recomputing count=5); nextTerminalNumber only increments, never reused.
    const number = get().nextTerminalNumber;
    const nextName = `${number}: powershell`;
    const newTerm = { id: nextId, name: nextName };
    set({
      terminals: [...get().terminals, newTerm],
      activeTerminalId: nextId,
      isTerminalOpen: true,
      nextTerminalNumber: number + 1,
    });
    if (api.createTerminal) {
      const resolvedCwd = cwd || useWorkspaceStore.getState().workspacePath || '.';
      const toolchain = useToolchainStore.getState();
      // Never block terminal creation on the toolchain.json read — if it hasn't loaded yet (e.g. this
      // is the very first terminal of the session), this terminal just starts with the plain PATH;
      // loadToolchain() (kicked off here if needed) still benefits every terminal created after it.
      api.createTerminal(nextId, resolvedCwd, toolchain.getExtraPathEntries());
      if (!toolchain.loaded) toolchain.loadToolchain();
    }
  },

  closeTerminal: (id) => {
    const api = window.api;
    if (api && api.closeTerminal) {
      api.closeTerminal(id);
    }
    const current = get().terminals;
    const nextTerminals = current.filter((t) => t.id !== id);
    let nextActive = get().activeTerminalId;
    if (nextActive === id) {
      nextActive = nextTerminals.length > 0 ? nextTerminals[nextTerminals.length - 1].id : null;
    }
    set({
      terminals: nextTerminals,
      activeTerminalId: nextActive,
      isTerminalOpen: nextTerminals.length > 0 ? get().isTerminalOpen : false,
    });
  },

  setActiveTerminal: (id) => {
    set({ activeTerminalId: id });
  },

  renameTerminal: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set({
      terminals: get().terminals.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    });
  },

  closeAllTerminals: () => {
    const currentTerminals = get().terminals;
    const api = window.api;
    if (api && api.closeTerminal) {
      currentTerminals.forEach((t) => {
        try {
          api.closeTerminal(t.id);
        } catch (e) {
          console.error(e);
        }
      });
    }
    set({ terminals: [], activeTerminalId: null, nextTerminalNumber: 1 });
  },
}));
