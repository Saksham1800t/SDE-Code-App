import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';
import type { ReferenceResult } from '../utils/referenceGrouping';

// Same scope limitation as store/outline.ts: Monaco's TS worker only sees files already open as models, matching the built-in "Find All References" exactly.
const TS_JS_LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);

// Incrementing token to discard a stale result: if a newer findReferences call starts before an older one's worker request resolves, the older result is dropped.
let requestId = 0;

interface ReferencesState {
  loading: boolean;
  /** null = "no search run yet this session" (panel stays hidden); false = last search ran on an unsupported language. */
  supported: boolean | null;
  symbolName: string | null;
  results: ReferenceResult[];
  /** Explicitly triggered (not auto-recomputed on every keystroke like Outline) — references are a point-in-time snapshot, not a live view. */
  findReferences: (monaco: any, editor: any) => Promise<void>;
  clear: () => void;
}

export const useReferencesStore = create<ReferencesState>((set) => ({
  loading: false,
  supported: null,
  symbolName: null,
  results: [],

  findReferences: async (monaco, editor) => {
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!model || !position) return;

    const languageId = model.getLanguageId();
    if (!TS_JS_LANGUAGES.has(languageId)) {
      requestId++;
      set({ results: [], supported: false, symbolName: null, loading: false });
      return;
    }

    const myRequestId = ++requestId;
    const word = model.getWordAtPosition(position)?.word ?? null;
    set({ loading: true, supported: true, symbolName: word, results: [] });

    const isJs = languageId === 'javascript' || languageId === 'javascriptreact';
    const getWorker = isJs ? monaco.languages.typescript.getJavaScriptWorker : monaco.languages.typescript.getTypeScriptWorker;

    try {
      const workerAccessor = await getWorker();
      const worker = await workerAccessor(model.uri);
      const offset = model.getOffsetAt(position);
      const entries = await worker.getReferencesAtPosition(model.uri.toString(), offset);

      // Recovers each result's original tab path by matching model URIs back to open tabs — openFileAtLocation needs the exact string tabs are keyed by, which a raw URI round-trip can alter cosmetically.
      const openTabs = useWorkspaceStore.getState().groups.flatMap((g) => g.tabs);
      const uriToPath = new Map(openTabs.map((t) => [monaco.Uri.parse(t.path).toString(), t.path]));

      const results: ReferenceResult[] = (entries ?? []).map((entry: any) => {
        const refModel = monaco.editor.getModel(monaco.Uri.parse(entry.fileName));
        const pos = refModel ? refModel.getPositionAt(entry.textSpan.start) : { lineNumber: 1, column: 1 };
        const lineText = refModel ? refModel.getLineContent(pos.lineNumber).trim() : '';
        const filePath = uriToPath.get(entry.fileName) ?? entry.fileName;
        return {
          filePath,
          fileName: filePath.split(/[\\/]/).pop() || filePath,
          line: pos.lineNumber,
          column: pos.column,
          lineText,
          isWriteAccess: !!entry.isWriteAccess,
        };
      });

      if (myRequestId !== requestId) return;
      set({ results, loading: false });
    } catch (err) {
      console.error('Failed to find references:', err);
      if (myRequestId === requestId) set({ loading: false, results: [] });
    }
  },

  clear: () => set({ results: [], symbolName: null, loading: false, supported: null }),
}));
