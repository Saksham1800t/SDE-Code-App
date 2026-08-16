import { create } from 'zustand';
import type { NotebookKernelStatus } from '@sde-code/protocol';
import { useWorkspaceStore } from './workspace';
import { parseNotebook, serializeNotebook, generateCellId, type NotebookDocument, type NotebookCellType } from '../utils/notebookFormat';

/** 'stopped' is a renderer-only extra state (no kernel process at all yet, or the user explicitly stopped it) — the main process never reports it, see NotebookKernelStatus's own doc comment. */
export type NotebookTabKernelStatus = NotebookKernelStatus | 'stopped';

export interface NotebookTabState {
  filePath: string;
  document: NotebookDocument;
  dirty: boolean;
  kernelId: string | null;
  kernelStatus: NotebookTabKernelStatus;
  runningCellId: string | null;
  /** The next In[]/Out[] execution number to stamp on a completed cell — increments on every done event, error or not, matching real Jupyter numbering. */
  nextExecutionCount: number;
}

interface NotebookState {
  tabs: Record<string, NotebookTabState>;

  openNotebook: (filePath: string, rawContent: string) => void;
  closeNotebook: (filePath: string) => void;
  /** Current in-memory document as .ipynb text, ready to hand to fs.writeFile — null if the tab isn't open. */
  serialize: (filePath: string) => string | null;
  markSaved: (filePath: string) => void;

  addCell: (filePath: string, afterCellId: string | null, cellType: NotebookCellType) => void;
  deleteCell: (filePath: string, cellId: string) => void;
  moveCell: (filePath: string, cellId: string, direction: 'up' | 'down') => void;
  updateCellSource: (filePath: string, cellId: string, source: string) => void;
  setCellType: (filePath: string, cellId: string, cellType: NotebookCellType) => void;

  startKernel: (filePath: string, interpreterPath?: string) => Promise<void>;
  runCell: (filePath: string, cellId: string) => Promise<void>;
  interruptKernel: (filePath: string) => void;
  restartKernel: (filePath: string) => void;
  stopKernel: (filePath: string) => void;
}

function resolveWorkspacePath(): string {
  const { workspacePath, workspaceFolders } = useWorkspaceStore.getState();
  return workspacePath || workspaceFolders[0]?.path || '';
}

function updateTab(filePath: string, fn: (tab: NotebookTabState) => NotebookTabState) {
  useNotebookStore.setState((state) => {
    const tab = state.tabs[filePath];
    if (!tab) return state;
    return { tabs: { ...state.tabs, [filePath]: fn(tab) } };
  });
}

function findTabByKernelId(tabs: Record<string, NotebookTabState>, kernelId: string): string | null {
  for (const [filePath, tab] of Object.entries(tabs)) {
    if (tab.kernelId === kernelId) return filePath;
  }
  return null;
}

// Registered once, lazily (not at module load — window.api isn't installed yet at import time in tests, and the real preload bridge is always ready before any store action runs anyway). Kernels persist for the app's lifetime regardless of which tab is focused, so one global subscription routing by kernelId is the right lifetime model — no per-tab subscribe/unsubscribe to leak.
let globalListenersInstalled = false;
function installGlobalListeners() {
  if (globalListenersInstalled) return;
  const api = window.api;
  if (!api?.onNotebookCellOutput || !api?.onNotebookCellDone || !api?.onNotebookKernelStatus) return;
  globalListenersInstalled = true;

  api.onNotebookCellOutput((kernelId, _executionId, name, text) => {
    const filePath = findTabByKernelId(useNotebookStore.getState().tabs, kernelId);
    if (!filePath) return;
    updateTab(filePath, (tab) => {
      if (!tab.runningCellId) return tab;
      return {
        ...tab,
        document: {
          ...tab.document,
          cells: tab.document.cells.map((cell) => {
            if (cell.id !== tab.runningCellId) return cell;
            const outputs = [...cell.outputs];
            const last = outputs[outputs.length - 1];
            // Coalesce consecutive same-stream chunks into one entry instead of growing one output per write() call — CPython's print() alone can split into several stream messages (see notebookKernelService.test.ts's comment on the same behavior).
            if (last?.type === 'stream' && last.name === name) {
              outputs[outputs.length - 1] = { ...last, text: last.text + text };
            } else {
              outputs.push({ type: 'stream', name, text });
            }
            return { ...cell, outputs };
          }),
        },
      };
    });
  });

  api.onNotebookCellDone((kernelId, _executionId, status, error) => {
    const filePath = findTabByKernelId(useNotebookStore.getState().tabs, kernelId);
    if (!filePath) return;
    updateTab(filePath, (tab) => {
      if (!tab.runningCellId) return tab;
      const cellId = tab.runningCellId;
      const executionCount = tab.nextExecutionCount;
      return {
        ...tab,
        runningCellId: null,
        nextExecutionCount: executionCount + 1,
        dirty: true,
        document: {
          ...tab.document,
          cells: tab.document.cells.map((cell) =>
            cell.id === cellId
              ? { ...cell, executionCount, outputs: status === 'error' && error ? [...cell.outputs, { type: 'error' as const, text: error }] : cell.outputs }
              : cell,
          ),
        },
      };
    });
  });

  api.onNotebookKernelStatus((kernelId, status) => {
    const filePath = findTabByKernelId(useNotebookStore.getState().tabs, kernelId);
    if (!filePath) return;
    updateTab(filePath, (tab) => ({ ...tab, kernelStatus: status }));
  });
}

/** Test-only: lets each test file install a fresh fake window.api and have startKernel() subscribe to it, rather than staying latched onto whichever fake object happened to be installed first. */
export function __resetNotebookGlobalListenersForTest(): void {
  globalListenersInstalled = false;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  tabs: {},

  openNotebook: (filePath, rawContent) => {
    const document = parseNotebook(rawContent);
    set((state) => ({
      tabs: { ...state.tabs, [filePath]: { filePath, document, dirty: false, kernelId: null, kernelStatus: 'stopped', runningCellId: null, nextExecutionCount: 1 } },
    }));
  },

  closeNotebook: (filePath) => {
    get().stopKernel(filePath);
    set((state) => {
      const { [filePath]: _removed, ...rest } = state.tabs;
      return { tabs: rest };
    });
  },

  serialize: (filePath) => {
    const tab = get().tabs[filePath];
    return tab ? serializeNotebook(tab.document) : null;
  },

  markSaved: (filePath) => updateTab(filePath, (tab) => ({ ...tab, dirty: false })),

  addCell: (filePath, afterCellId, cellType) => {
    updateTab(filePath, (tab) => {
      const cells = tab.document.cells;
      const idx = afterCellId ? cells.findIndex((c) => c.id === afterCellId) : cells.length - 1;
      const insertAt = idx === -1 ? cells.length : idx + 1;
      const newCell = { id: generateCellId(), cellType, source: '', outputs: [], executionCount: null };
      return { ...tab, dirty: true, document: { ...tab.document, cells: [...cells.slice(0, insertAt), newCell, ...cells.slice(insertAt)] } };
    });
  },

  deleteCell: (filePath, cellId) => {
    updateTab(filePath, (tab) => ({
      ...tab,
      dirty: true,
      runningCellId: tab.runningCellId === cellId ? null : tab.runningCellId,
      document: { ...tab.document, cells: tab.document.cells.filter((c) => c.id !== cellId) },
    }));
  },

  moveCell: (filePath, cellId, direction) => {
    updateTab(filePath, (tab) => {
      const cells = [...tab.document.cells];
      const idx = cells.findIndex((c) => c.id === cellId);
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (idx === -1 || swapWith < 0 || swapWith >= cells.length) return tab;
      [cells[idx], cells[swapWith]] = [cells[swapWith], cells[idx]];
      return { ...tab, dirty: true, document: { ...tab.document, cells } };
    });
  },

  updateCellSource: (filePath, cellId, source) => {
    updateTab(filePath, (tab) => ({
      ...tab,
      dirty: true,
      document: { ...tab.document, cells: tab.document.cells.map((c) => (c.id === cellId ? { ...c, source } : c)) },
    }));
  },

  setCellType: (filePath, cellId, cellType) => {
    updateTab(filePath, (tab) => ({
      ...tab,
      dirty: true,
      document: {
        ...tab.document,
        cells: tab.document.cells.map((c) =>
          c.id === cellId ? { ...c, cellType, outputs: cellType === 'markdown' ? [] : c.outputs, executionCount: cellType === 'markdown' ? null : c.executionCount } : c,
        ),
      },
    }));
  },

  startKernel: async (filePath, interpreterPath) => {
    const api = window.api;
    if (!api) return;
    installGlobalListeners();
    const tab = get().tabs[filePath];
    if (!tab || tab.kernelId || tab.kernelStatus === 'starting') return;

    updateTab(filePath, (t) => ({ ...t, kernelStatus: 'starting' }));
    try {
      const { kernelId } = await api.startNotebookKernel(tab.document.language, resolveWorkspacePath(), interpreterPath);
      updateTab(filePath, (t) => ({ ...t, kernelId }));
    } catch {
      updateTab(filePath, (t) => ({ ...t, kernelStatus: 'dead' }));
    }
  },

  runCell: async (filePath, cellId) => {
    const api = window.api;
    if (!api) return;
    const tab = get().tabs[filePath];
    if (!tab || tab.kernelStatus === 'busy') return;

    if (!tab.kernelId || tab.kernelStatus === 'dead' || tab.kernelStatus === 'stopped') {
      await get().startKernel(filePath);
    }
    const current = get().tabs[filePath];
    const kernelId = current?.kernelId;
    const cell = current?.document.cells.find((c) => c.id === cellId);
    if (!kernelId || !cell || cell.cellType !== 'code') return;

    updateTab(filePath, (t) => ({
      ...t,
      runningCellId: cellId,
      document: { ...t.document, cells: t.document.cells.map((c) => (c.id === cellId ? { ...c, outputs: [] } : c)) },
    }));

    try {
      await api.executeNotebookCell(kernelId, cell.source);
    } catch {
      updateTab(filePath, (t) => (t.runningCellId === cellId ? { ...t, runningCellId: null } : t));
    }
  },

  interruptKernel: (filePath) => {
    const tab = get().tabs[filePath];
    if (tab?.kernelId) window.api?.interruptNotebookKernel(tab.kernelId);
  },

  restartKernel: (filePath) => {
    const tab = get().tabs[filePath];
    if (!tab?.kernelId) return;
    const kernelId = tab.kernelId;
    updateTab(filePath, (t) => ({ ...t, kernelStatus: 'starting', runningCellId: null, nextExecutionCount: 1 }));
    window.api?.restartNotebookKernel(kernelId, tab.document.language, resolveWorkspacePath());
  },

  stopKernel: (filePath) => {
    const tab = get().tabs[filePath];
    if (!tab?.kernelId) return;
    window.api?.stopNotebookKernel(tab.kernelId);
    updateTab(filePath, (t) => ({ ...t, kernelId: null, kernelStatus: 'stopped', runningCellId: null }));
  },
}));
