import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useNotebookStore, __resetNotebookGlobalListenersForTest } from './notebook';
import { useWorkspaceStore } from './workspace';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';
import { serializeNotebook } from '../utils/notebookFormat';

const SAMPLE_IPYNB = JSON.stringify({
  cells: [
    { cell_type: 'code', id: 'c1', execution_count: null, outputs: [], source: 'x = 1' },
    { cell_type: 'markdown', id: 'm1', source: '# Title' },
  ],
  metadata: { kernelspec: { language: 'python' } },
  nbformat: 4,
  nbformat_minor: 5,
});

describe('useNotebookStore', () => {
  beforeEach(() => {
    useNotebookStore.setState(useNotebookStore.getInitialState());
    useWorkspaceStore.setState({ workspaceFolders: [{ path: '/repo', name: 'repo' }], activeFolderPath: '/repo', workspacePath: '/repo' } as any);
    __resetNotebookGlobalListenersForTest();
    installFakeDesktopApi();
  });

  describe('openNotebook / closeNotebook / serialize', () => {
    it('parses raw .ipynb content into tab state', () => {
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
      const tab = useNotebookStore.getState().tabs['/repo/nb.ipynb'];
      expect(tab.document.cells).toHaveLength(2);
      expect(tab.document.language).toBe('python');
      expect(tab.dirty).toBe(false);
      expect(tab.kernelStatus).toBe('stopped');
    });

    it('serialize round-trips through the notebook format utility', () => {
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
      const serialized = useNotebookStore.getState().serialize('/repo/nb.ipynb')!;
      expect(serialized).toBe(serializeNotebook(useNotebookStore.getState().tabs['/repo/nb.ipynb'].document));
    });

    it('serialize returns null for a tab that is not open', () => {
      expect(useNotebookStore.getState().serialize('/repo/missing.ipynb')).toBeNull();
    });

    it('closeNotebook removes the tab and stops any running kernel', async () => {
      const stopNotebookKernel = vi.fn(async () => {});
      installFakeDesktopApi({ stopNotebookKernel: stopNotebookKernel as any, startNotebookKernel: vi.fn(async () => ({ kernelId: 'k1' })) as any });
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
      await useNotebookStore.getState().startKernel('/repo/nb.ipynb');

      useNotebookStore.getState().closeNotebook('/repo/nb.ipynb');

      expect(stopNotebookKernel).toHaveBeenCalledWith('k1');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb']).toBeUndefined();
    });
  });

  describe('cell CRUD', () => {
    beforeEach(() => {
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
    });

    it('addCell inserts after the given cell and marks the tab dirty', () => {
      useNotebookStore.getState().addCell('/repo/nb.ipynb', 'c1', 'code');
      const cells = useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells;
      expect(cells.map((c) => c.id)).toEqual(['c1', expect.any(String), 'm1']);
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].dirty).toBe(true);
    });

    it('addCell with no afterCellId appends to the end', () => {
      useNotebookStore.getState().addCell('/repo/nb.ipynb', null, 'markdown');
      const cells = useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells;
      expect(cells.map((c) => c.id)).toEqual(['c1', 'm1', expect.any(String)]);
      expect(cells[2].cellType).toBe('markdown');
    });

    it('deleteCell removes the cell', () => {
      useNotebookStore.getState().deleteCell('/repo/nb.ipynb', 'c1');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells.map((c) => c.id)).toEqual(['m1']);
    });

    it('deleteCell clears runningCellId if the running cell is deleted', () => {
      useNotebookStore.setState((state) => ({
        tabs: { ...state.tabs, '/repo/nb.ipynb': { ...state.tabs['/repo/nb.ipynb'], runningCellId: 'c1' } },
      }));
      useNotebookStore.getState().deleteCell('/repo/nb.ipynb', 'c1');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].runningCellId).toBeNull();
    });

    it('moveCell swaps a cell with its neighbor', () => {
      useNotebookStore.getState().moveCell('/repo/nb.ipynb', 'm1', 'up');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells.map((c) => c.id)).toEqual(['m1', 'c1']);
    });

    it('moveCell is a no-op past the boundary', () => {
      useNotebookStore.getState().moveCell('/repo/nb.ipynb', 'c1', 'up');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells.map((c) => c.id)).toEqual(['c1', 'm1']);
    });

    it('updateCellSource updates the source and marks dirty', () => {
      useNotebookStore.getState().updateCellSource('/repo/nb.ipynb', 'c1', 'x = 2');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells[0].source).toBe('x = 2');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].dirty).toBe(true);
    });

    it('setCellType clears outputs/executionCount when turning a code cell into markdown', () => {
      useNotebookStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          '/repo/nb.ipynb': {
            ...state.tabs['/repo/nb.ipynb'],
            document: {
              ...state.tabs['/repo/nb.ipynb'].document,
              cells: state.tabs['/repo/nb.ipynb'].document.cells.map((c) =>
                c.id === 'c1' ? { ...c, outputs: [{ type: 'stream' as const, name: 'stdout' as const, text: 'hi' }], executionCount: 1 } : c,
              ),
            },
          },
        },
      }));
      useNotebookStore.getState().setCellType('/repo/nb.ipynb', 'c1', 'markdown');
      const cell = useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells[0];
      expect(cell.cellType).toBe('markdown');
      expect(cell.outputs).toEqual([]);
      expect(cell.executionCount).toBeNull();
    });

    it('markSaved clears the dirty flag', () => {
      useNotebookStore.getState().updateCellSource('/repo/nb.ipynb', 'c1', 'x = 2');
      useNotebookStore.getState().markSaved('/repo/nb.ipynb');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].dirty).toBe(false);
    });
  });

  describe('startKernel', () => {
    beforeEach(() => {
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
    });

    it('calls startNotebookKernel with the document language and workspace path, and stores the kernelId', async () => {
      const startNotebookKernel = vi.fn(async () => ({ kernelId: 'k1' }));
      installFakeDesktopApi({ startNotebookKernel: startNotebookKernel as any });

      await useNotebookStore.getState().startKernel('/repo/nb.ipynb');

      expect(startNotebookKernel).toHaveBeenCalledWith('python', '/repo', undefined);
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].kernelId).toBe('k1');
    });

    it('sets kernelStatus to dead if startNotebookKernel rejects', async () => {
      installFakeDesktopApi({ startNotebookKernel: vi.fn(async () => { throw new Error('boom'); }) as any });

      await useNotebookStore.getState().startKernel('/repo/nb.ipynb');

      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].kernelStatus).toBe('dead');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].kernelId).toBeNull();
    });

    it('does not start a second kernel while one is already starting or running', async () => {
      const startNotebookKernel = vi.fn(async () => ({ kernelId: 'k1' }));
      installFakeDesktopApi({ startNotebookKernel: startNotebookKernel as any });

      const first = useNotebookStore.getState().startKernel('/repo/nb.ipynb');
      useNotebookStore.getState().startKernel('/repo/nb.ipynb');
      await first;

      expect(startNotebookKernel).toHaveBeenCalledTimes(1);
    });
  });

  describe('runCell and streamed output routing', () => {
    let emitOutput: ((kernelId: string, executionId: string, name: 'stdout' | 'stderr', text: string) => void) | undefined;
    let emitDone: ((kernelId: string, executionId: string, status: 'ok' | 'error', error: string | null) => void) | undefined;
    let emitStatus: ((kernelId: string, status: any) => void) | undefined;

    beforeEach(() => {
      installFakeDesktopApi({
        startNotebookKernel: vi.fn(async () => ({ kernelId: 'k1' })) as any,
        executeNotebookCell: vi.fn(async () => ({ executionId: 'e1' })) as any,
        onNotebookCellOutput: vi.fn((cb: any) => { emitOutput = cb; return () => {}; }) as any,
        onNotebookCellDone: vi.fn((cb: any) => { emitDone = cb; return () => {}; }) as any,
        onNotebookKernelStatus: vi.fn((cb: any) => { emitStatus = cb; return () => {}; }) as any,
      });
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
    });

    it('starts a kernel on first run and executes the cell, setting runningCellId', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].kernelId).toBe('k1');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].runningCellId).toBe('c1');
    });

    it('does not run a non-code (markdown) cell', async () => {
      const executeNotebookCell = vi.fn(async () => ({ executionId: 'e1' }));
      installFakeDesktopApi({ startNotebookKernel: vi.fn(async () => ({ kernelId: 'k1' })) as any, executeNotebookCell: executeNotebookCell as any });

      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'm1');

      expect(executeNotebookCell).not.toHaveBeenCalled();
    });

    it('routes onNotebookCellOutput to the running cell, appending stream text', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');

      emitOutput?.('k1', 'e1', 'stdout', 'hello\n');
      emitOutput?.('k1', 'e1', 'stdout', 'world\n');

      const cell = useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells[0];
      expect(cell.outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'hello\nworld\n' }]);
    });

    it('keeps stdout and stderr as separate output entries rather than merging them', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');

      emitOutput?.('k1', 'e1', 'stdout', 'out\n');
      emitOutput?.('k1', 'e1', 'stderr', 'err\n');

      const cell = useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells[0];
      expect(cell.outputs).toEqual([
        { type: 'stream', name: 'stdout', text: 'out\n' },
        { type: 'stream', name: 'stderr', text: 'err\n' },
      ]);
    });

    it('ignores output events for a kernelId that does not belong to any open tab', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');
      emitOutput?.('some-unrelated-kernel', 'e1', 'stdout', 'nope\n');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells[0].outputs).toEqual([]);
    });

    it('onNotebookCellDone clears runningCellId, stamps executionCount, and marks dirty', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');

      emitDone?.('k1', 'e1', 'ok', null);

      const tab = useNotebookStore.getState().tabs['/repo/nb.ipynb'];
      expect(tab.runningCellId).toBeNull();
      expect(tab.dirty).toBe(true);
      expect(tab.document.cells[0].executionCount).toBe(1);
      expect(tab.nextExecutionCount).toBe(2);
    });

    it('onNotebookCellDone with an error appends an error output', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');

      emitDone?.('k1', 'e1', 'error', 'Traceback...\nValueError: boom');

      const cell = useNotebookStore.getState().tabs['/repo/nb.ipynb'].document.cells[0];
      expect(cell.outputs).toEqual([{ type: 'error', text: 'Traceback...\nValueError: boom' }]);
    });

    it('onNotebookKernelStatus updates the tab kernelStatus', async () => {
      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');
      emitStatus?.('k1', 'busy');
      expect(useNotebookStore.getState().tabs['/repo/nb.ipynb'].kernelStatus).toBe('busy');
    });

    it('runCell is a no-op while the kernel is busy', async () => {
      const executeNotebookCell = vi.fn(async () => ({ executionId: 'e1' }));
      installFakeDesktopApi({
        startNotebookKernel: vi.fn(async () => ({ kernelId: 'k1' })) as any,
        executeNotebookCell: executeNotebookCell as any,
        onNotebookCellOutput: vi.fn((cb: any) => { emitOutput = cb; return () => {}; }) as any,
        onNotebookCellDone: vi.fn((cb: any) => { emitDone = cb; return () => {}; }) as any,
        onNotebookKernelStatus: vi.fn((cb: any) => { emitStatus = cb; return () => {}; }) as any,
      });

      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');
      emitStatus?.('k1', 'busy');

      await useNotebookStore.getState().runCell('/repo/nb.ipynb', 'c1');

      expect(executeNotebookCell).toHaveBeenCalledTimes(1);
    });
  });

  describe('interruptKernel / restartKernel / stopKernel', () => {
    beforeEach(async () => {
      installFakeDesktopApi({ startNotebookKernel: vi.fn(async () => ({ kernelId: 'k1' })) as any });
      useNotebookStore.getState().openNotebook('/repo/nb.ipynb', SAMPLE_IPYNB);
      await useNotebookStore.getState().startKernel('/repo/nb.ipynb');
    });

    it('interruptKernel calls the api with the current kernelId', () => {
      const interruptNotebookKernel = vi.fn(async () => {});
      installFakeDesktopApi({ interruptNotebookKernel: interruptNotebookKernel as any });
      useNotebookStore.getState().interruptKernel('/repo/nb.ipynb');
      expect(interruptNotebookKernel).toHaveBeenCalledWith('k1');
    });

    it('restartKernel resets local execution state and calls the api', () => {
      const restartNotebookKernel = vi.fn(async () => {});
      installFakeDesktopApi({ restartNotebookKernel: restartNotebookKernel as any });

      useNotebookStore.getState().restartKernel('/repo/nb.ipynb');

      expect(restartNotebookKernel).toHaveBeenCalledWith('k1', 'python', '/repo');
      const tab = useNotebookStore.getState().tabs['/repo/nb.ipynb'];
      expect(tab.kernelStatus).toBe('starting');
      expect(tab.nextExecutionCount).toBe(1);
    });

    it('stopKernel calls the api and clears kernelId/status locally', () => {
      const stopNotebookKernel = vi.fn(async () => {});
      installFakeDesktopApi({ stopNotebookKernel: stopNotebookKernel as any });

      useNotebookStore.getState().stopKernel('/repo/nb.ipynb');

      expect(stopNotebookKernel).toHaveBeenCalledWith('k1');
      const tab = useNotebookStore.getState().tabs['/repo/nb.ipynb'];
      expect(tab.kernelId).toBeNull();
      expect(tab.kernelStatus).toBe('stopped');
    });

    it('interruptKernel/restartKernel/stopKernel are no-ops when no kernel is running', () => {
      useNotebookStore.getState().stopKernel('/repo/nb.ipynb');
      const restartNotebookKernel = vi.fn(async () => {});
      const interruptNotebookKernel = vi.fn(async () => {});
      installFakeDesktopApi({ restartNotebookKernel: restartNotebookKernel as any, interruptNotebookKernel: interruptNotebookKernel as any });

      useNotebookStore.getState().interruptKernel('/repo/nb.ipynb');
      useNotebookStore.getState().restartKernel('/repo/nb.ipynb');

      expect(interruptNotebookKernel).not.toHaveBeenCalled();
      expect(restartNotebookKernel).not.toHaveBeenCalled();
    });
  });
});
