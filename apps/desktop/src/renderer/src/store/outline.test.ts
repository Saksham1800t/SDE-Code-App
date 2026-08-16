import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useOutlineStore } from './outline';

function makeModel(overrides: { languageId?: string; navTree?: any } = {}) {
  const languageId = overrides.languageId ?? 'typescript';
  const navTree = overrides.navTree ?? {
    text: '<global>',
    childItems: [{ text: 'foo', kind: 'function', spans: [{ start: 0, length: 5 }] }],
  };
  const worker = { getNavigationTree: vi.fn(async () => navTree) };
  const getTypeScriptWorker = vi.fn(async () => vi.fn(async () => worker));
  const getJavaScriptWorker = vi.fn(async () => vi.fn(async () => worker));
  const monaco = { languages: { typescript: { getTypeScriptWorker, getJavaScriptWorker } } };
  const model = {
    getLanguageId: () => languageId,
    uri: 'file:///repo/a.ts',
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
  };
  return { monaco, model, worker, getTypeScriptWorker, getJavaScriptWorker };
}

describe('useOutlineStore', () => {
  beforeEach(() => {
    useOutlineStore.setState(useOutlineStore.getInitialState());
  });

  describe('recompute', () => {
    it('marks unsupported and clears symbols for a non-TS/JS language', async () => {
      const { monaco, model } = makeModel({ languageId: 'json' });

      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.json');

      const state = useOutlineStore.getState();
      expect(state.supported).toBe(false);
      expect(state.symbols).toEqual([]);
    });

    it('uses getTypeScriptWorker for a typescript file and converts the navigation tree', async () => {
      const { monaco, model, getTypeScriptWorker } = makeModel({ languageId: 'typescript' });

      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');

      expect(getTypeScriptWorker).toHaveBeenCalled();
      const state = useOutlineStore.getState();
      expect(state.supported).toBe(true);
      expect(state.symbols).toHaveLength(1);
      expect(state.symbols[0].name).toBe('foo');
    });

    it('uses getJavaScriptWorker (not getTypeScriptWorker) for a javascript file', async () => {
      const { monaco, model, getTypeScriptWorker, getJavaScriptWorker } = makeModel({ languageId: 'javascript' });

      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.js');

      expect(getJavaScriptWorker).toHaveBeenCalled();
      expect(getTypeScriptWorker).not.toHaveBeenCalled();
    });

    it('discards a stale response that resolves after the active file changed', async () => {
      // Gate getNavigationTree so it doesn't resolve until this test says so
      // — and only flips the "called" flag once recompute has actually
      // reached that call, so the file-switch below is guaranteed to land
      // mid-flight rather than racing recompute's own earlier awaits
      // (getTypeScriptWorker(), then the worker accessor) that resolve on
      // their own microtask ticks first.
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
      let getNavigationTreeCalled = false;
      const worker = {
        getNavigationTree: vi.fn(async () => {
          getNavigationTreeCalled = true;
          await gate;
          return { text: '<global>', childItems: [{ text: 'stale', kind: 'function', spans: [{ start: 0, length: 1 }] }] };
        }),
      };
      const monaco = {
        languages: {
          typescript: {
            getTypeScriptWorker: vi.fn(async () => vi.fn(async () => worker)),
            getJavaScriptWorker: vi.fn(),
          },
        },
      };
      const model = { getLanguageId: () => 'typescript', uri: 'file:///repo/a.ts', getPositionAt: (o: number) => ({ lineNumber: 1, column: o + 1 }) };

      const pending = useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');
      await vi.waitFor(() => {
        if (!getNavigationTreeCalled) throw new Error('getNavigationTree not called yet');
      });
      // Simulate the user switching to a different file before the worker responds.
      useOutlineStore.setState({ activeFilePath: '/repo/b.ts' });
      releaseGate();
      await pending;

      expect(useOutlineStore.getState().symbols).toEqual([]);
    });

    it('resets to unsupported when the worker call throws on every attempt, for the currently active file', async () => {
      const monaco = {
        languages: {
          typescript: {
            getTypeScriptWorker: vi.fn(async () => { throw new Error('worker failed'); }),
            getJavaScriptWorker: vi.fn(),
          },
        },
      };
      const model = { getLanguageId: () => 'typescript', uri: 'file:///repo/a.ts', getPositionAt: (o: number) => ({ lineNumber: 1, column: o + 1 }) };

      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');

      const state = useOutlineStore.getState();
      expect(state.supported).toBe(false);
      expect(state.symbols).toEqual([]);
      // Retried once before giving up.
      expect(monaco.languages.typescript.getTypeScriptWorker).toHaveBeenCalledTimes(2);
    });

    it('retries once and succeeds if the worker becomes available on the second attempt (e.g. cold Web Worker spin-up)', async () => {
      const navTree = { text: '<global>', childItems: [{ text: 'foo', kind: 'function', spans: [{ start: 0, length: 5 }] }] };
      const worker = { getNavigationTree: vi.fn(async () => navTree) };
      let calls = 0;
      const getTypeScriptWorker = vi.fn(async () => {
        calls++;
        if (calls === 1) throw new Error('worker not ready yet');
        return vi.fn(async () => worker);
      });
      const monaco = { languages: { typescript: { getTypeScriptWorker, getJavaScriptWorker: vi.fn() } } };
      const model = { getLanguageId: () => 'typescript', uri: 'file:///repo/a.ts', getPositionAt: (o: number) => ({ lineNumber: 1, column: o + 1 }) };

      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');

      const state = useOutlineStore.getState();
      expect(state.supported).toBe(true);
      expect(state.symbols).toHaveLength(1);
      expect(getTypeScriptWorker).toHaveBeenCalledTimes(2);
    }, 2000);
  });

  describe('updateCursorPosition', () => {
    it('sets currentSymbol to the symbol containing the given position', async () => {
      const { monaco, model } = makeModel();
      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');

      useOutlineStore.getState().updateCursorPosition(1, 2);

      expect(useOutlineStore.getState().currentSymbol?.name).toBe('foo');
    });

    it('sets currentSymbol to null when the position is outside every symbol', async () => {
      const { monaco, model } = makeModel();
      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');

      useOutlineStore.getState().updateCursorPosition(50, 1);

      expect(useOutlineStore.getState().currentSymbol).toBeNull();
    });
  });

  describe('clear', () => {
    it('resets all state', async () => {
      const { monaco, model } = makeModel();
      await useOutlineStore.getState().recompute(monaco, model, '/repo/a.ts');

      useOutlineStore.getState().clear();

      expect(useOutlineStore.getState()).toMatchObject({
        activeFilePath: null,
        symbols: [],
        supported: false,
        currentSymbol: null,
      });
    });
  });
});
