import { create } from 'zustand';
import { convertNavigationTree, findSymbolAtPosition, type OutlineSymbol } from '../utils/outlineTree';

// Only TS/JS is supported: Monaco's other bundled languages have no public worker API exposing an equivalent to getNavigationTree (see outlineTree.ts).
const TS_JS_LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);

interface OutlineState {
  activeFilePath: string | null;
  symbols: OutlineSymbol[];
  supported: boolean;
  /** Innermost symbol containing the cursor — the breadcrumb's trailing segment. */
  currentSymbol: OutlineSymbol | null;
  recompute: (monaco: any, model: any, filePath: string) => Promise<void>;
  updateCursorPosition: (line: number, column: number) => void;
  clear: () => void;
}

export const useOutlineStore = create<OutlineState>((set, get) => ({
  activeFilePath: null,
  symbols: [],
  supported: false,
  currentSymbol: null,

  recompute: async (monaco, model, filePath) => {
    set({ activeFilePath: filePath });
    const languageId = model.getLanguageId();
    if (!TS_JS_LANGUAGES.has(languageId)) {
      set({ symbols: [], supported: false, currentSymbol: null });
      return;
    }

    const isJs = languageId === 'javascript' || languageId === 'javascriptreact';
    const getWorker = isJs ? monaco.languages.typescript.getJavaScriptWorker : monaco.languages.typescript.getTypeScriptWorker;

    // The TS/JS worker thread can fail/hang on its first-use spin-up even though monaco itself is loaded; one retry is enough in practice.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const workerAccessor = await getWorker();
        const worker = await workerAccessor(model.uri);
        const tree = await worker.getNavigationTree(model.uri.toString());
        // Guard against a stale response landing after the user switched tabs during this round-trip.
        if (get().activeFilePath !== filePath) return;
        const symbols = tree ? convertNavigationTree(tree, model.getPositionAt.bind(model)) : [];
        set({ symbols, supported: true });
        return;
      } catch (err) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        console.error('Failed to compute outline:', err);
        if (get().activeFilePath === filePath) set({ symbols: [], supported: false });
      }
    }
  },

  updateCursorPosition: (line, column) => {
    set({ currentSymbol: findSymbolAtPosition(get().symbols, line, column) });
  },

  clear: () => set({ activeFilePath: null, symbols: [], supported: false, currentSymbol: null }),
}));
