import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';
import { useGitStore } from './git';
import { customAlert } from './alerts';
import { applyRenameToText, groupRenameLocationsByFile } from '../utils/bulkRename';

// Same limitation as store/references.ts: Monaco's TS worker only sees currently-open models, so rename locations are always backed by an open tab.
const TS_JS_LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);

export interface BulkRenameFileEdit {
  filePath: string;
  fileName: string;
  originalText: string;
  newText: string;
  locationCount: number;
  included: boolean;
}

interface BulkRenameState {
  loading: boolean;
  oldName: string | null;
  newName: string | null;
  files: BulkRenameFileEdit[];
  applying: boolean;
  startRename: (monaco: any, editor: any) => Promise<void>;
  toggleFileIncluded: (filePath: string) => void;
  updateFileNewText: (filePath: string, newText: string) => void;
  applyRename: () => Promise<{ appliedCount: number }>;
  clear: () => void;
}

export const useBulkRenameStore = create<BulkRenameState>((set, get) => ({
  loading: false,
  oldName: null,
  newName: null,
  files: [],
  applying: false,

  startRename: async (monaco, editor) => {
    const model = editor?.getModel();
    const position = editor?.getPosition();
    if (!model || !position) return;

    const languageId = model.getLanguageId();
    if (!TS_JS_LANGUAGES.has(languageId)) {
      customAlert('Rename Symbol (Preview) is only available for TypeScript/JavaScript files.');
      return;
    }

    const isJs = languageId === 'javascript' || languageId === 'javascriptreact';
    const getWorker = isJs ? monaco.languages.typescript.getJavaScriptWorker : monaco.languages.typescript.getTypeScriptWorker;

    try {
      const workerAccessor = await getWorker();
      const worker = await workerAccessor(model.uri);
      const offset = model.getOffsetAt(position);

      const renameInfo = await worker.getRenameInfo(model.uri.toString(), offset, {});
      if (!renameInfo?.canRename) {
        customAlert(renameInfo?.localizedErrorMessage || 'This position can\'t be renamed.');
        return;
      }
      // Matches Monaco's own RenameAdapter: doesn't support a rename that would also rename the containing file.
      if (renameInfo.fileToRename) {
        customAlert('Renaming files is not supported.');
        return;
      }

      const newNameInput = window.prompt(`Rename "${renameInfo.displayName}" to:`, renameInfo.displayName);
      if (!newNameInput || newNameInput === renameInfo.displayName) return;

      set({ loading: true, oldName: renameInfo.displayName, newName: newNameInput, files: [] });
      useWorkspaceStore.getState().openBulkRenameTab();

      const rawLocations = await worker.findRenameLocations(model.uri.toString(), offset, false, false, false);
      if (!rawLocations || rawLocations.length === 0) {
        set({ loading: false });
        customAlert('No rename locations found.');
        return;
      }

      const openTabs = useWorkspaceStore.getState().groups.flatMap((g) => g.tabs);
      const uriToTab = new Map(openTabs.map((t) => [monaco.Uri.parse(t.path).toString(), t]));

      const grouped = groupRenameLocationsByFile(rawLocations);
      const files: BulkRenameFileEdit[] = [];
      for (const [fileUri, locations] of grouped) {
        const tab = uriToTab.get(fileUri);
        if (!tab) continue; // worker-visible file with no matching open tab — can't resolve a real path, skip rather than guess
        files.push({
          filePath: tab.path,
          fileName: tab.path.split(/[\\/]/).pop() || tab.path,
          originalText: tab.content,
          newText: applyRenameToText(tab.content, locations.map((l) => l.textSpan), newNameInput),
          locationCount: locations.length,
          included: true,
        });
      }

      set({ loading: false, files });
    } catch (err) {
      console.error('Failed to compute rename preview:', err);
      set({ loading: false });
      customAlert('Failed to compute a rename preview for this symbol.');
    }
  },

  toggleFileIncluded: (filePath) => {
    set({
      files: get().files.map((f) => (f.filePath === filePath ? { ...f, included: !f.included } : f)),
    });
  },

  updateFileNewText: (filePath, newText) => {
    set({
      files: get().files.map((f) => (f.filePath === filePath ? { ...f, newText } : f)),
    });
  },

  applyRename: async () => {
    const api = window.api;
    if (!api) return { appliedCount: 0 };
    const included = get().files.filter((f) => f.included);
    if (included.length === 0) return { appliedCount: 0 };

    set({ applying: true });
    try {
      for (const f of included) {
        await api.writeFile(f.filePath, f.newText);
        useWorkspaceStore.getState().setTabContent(f.filePath, f.newText, false);
      }
      useGitStore.getState().loadGitStatus();
      // Filters get().files (current state, not the pre-loop snapshot) so concurrent edits during the async write loop aren't discarded.
      const appliedPaths = new Set(included.map((f) => f.filePath));
      set({ applying: false, files: get().files.filter((f) => !appliedPaths.has(f.filePath)) });
      return { appliedCount: included.length };
    } catch (err) {
      console.error('Failed to apply rename:', err);
      set({ applying: false });
      return { appliedCount: 0 };
    }
  },

  clear: () => set({ loading: false, oldName: null, newName: null, files: [], applying: false }),
}));
