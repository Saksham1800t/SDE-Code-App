import { create } from 'zustand';
import { useStatusBarStore } from './statusBar';
import { useGitStore, type GitCommit } from './git';
import { useTerminalStore } from './terminal';
import { useFeatureFlagsStore } from './featureFlags';
import { customAlert } from './alerts';
import { customConfirm } from './confirm';
import { promptUnsavedChanges } from './unsavedChanges';
import { DIALOG_MESSAGES } from '../utils/dialogMessages';
import { parseWorkspaceFile, serializeWorkspaceFile } from '../utils/workspaceFile';
import { isLspManagedFile, notifyFileOpened, notifyFileChanged, notifyFileClosed } from '../lsp';
import { useMultibufferStore } from './multibuffer';
import { useNotebookStore } from './notebook';
import type { SearchInFilesOptions } from '@sde-code/protocol';
import type { MultibufferExcerptSource } from '../utils/multibuffer';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  children?: FileNode[];
  isOpen?: boolean;
}

export interface EditorTab {
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
  isDiff?: boolean;
  originalContent?: string;
  isSettings?: boolean;
  settingsType?: 'settings' | 'shortcuts';
  isExtensionDetails?: boolean;
  extensionId?: string;
  isCreateExtension?: boolean;
  createExtensionTemplateType?: 'theme' | 'snippets';
  createExtensionSourceLanguageId?: string;
  isRepoOverview?: boolean;
  isCommitDetails?: boolean;
  commitHash?: string;
  commitShortHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitDate?: string;
  isCodeHotspots?: boolean;
  isBranchComparison?: boolean;
  isGitGraph?: boolean;
  isLocalHistory?: boolean;
  localHistoryFilePath?: string;
  localHistoryWorkspacePath?: string;
  /** Read-only image viewer — content is unused (never text-read; see IMAGE_EXTENSIONS in workspace.ts). */
  isImagePreview?: boolean;
  /** Read-only rendered-markdown view of markdownSourcePath, opened via "Open Preview" — a separate tab from the normal editable markdown tab, not a replacement for it. */
  isMarkdownPreview?: boolean;
  markdownSourcePath?: string;
  /** Dedicated 3-pane conflict resolution view — a separate synthetic tab, not wired into normal dirty-tracking/auto-save; MergeEditorPanel saves directly via writeFile. */
  isMergeEditor?: boolean;
  mergeEditorFilePath?: string;
  /** In-app browser tab (Electron <webview>) — see BrowserPreviewPanel.tsx. */
  isBrowserPreview?: boolean;
  browserPreviewUrl?: string;
  /** GitHub PR/Issue detail tab — see GitHubItemDetailPanel.tsx. */
  isGitHubItem?: boolean;
  gitHubItemNumber?: number;
  gitHubItemIsPR?: boolean;
  /** Read-only audio/video players — same never-text-read reasoning as isImagePreview. */
  isAudioPreview?: boolean;
  isVideoPreview?: boolean;
  /** A saved, editable, re-runnable snapshot of a search's results — see SearchEditorPanel.tsx. content holds the rendered document text. */
  isSearchEditor?: boolean;
  searchEditorQuery?: string;
  searchEditorOptions?: SearchInFilesOptions;
  /** Cross-file rename preview — see BulkRenamePreviewPanel.tsx. Data lives in store/bulkRename.ts (one global in-flight preview at a time), not on the tab itself. */
  isBulkRename?: boolean;
  /** Editable, multi-file excerpt view — see MultibufferPanel.tsx. Excerpt sources live in store/multibuffer.ts keyed by this tab's path (several multibuffer tabs can be open at once, unlike bulk-rename). */
  isMultibuffer?: boolean;
  /** REPL/notebook cells — see NotebookPanel.tsx. content mirrors store/notebook.ts's serialized document (kept in sync by the panel itself, same convention as SearchEditorPanel's setTabContent usage) so the existing save/dirty/close-confirmation machinery needs no notebook-specific logic. */
  isNotebook?: boolean;
}

const isNotebookPath = (filePath: string): boolean => filePath.toLowerCase().endsWith('.ipynb');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico']);
const isImagePath = (filePath: string): boolean => {
  const dot = filePath.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
};

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
const isAudioPath = (filePath: string): boolean => {
  const dot = filePath.lastIndexOf('.');
  return dot !== -1 && AUDIO_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);
const isVideoPath = (filePath: string): boolean => {
  const dot = filePath.lastIndexOf('.');
  return dot !== -1 && VIDEO_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
};

/** One independent editor pane; groups render side-by-side for split-editor support. A file opened in two groups gets two independent buffers (not a shared Monaco model), so edits don't mirror each other — a deliberate scope boundary. */
export interface EditorGroup {
  id: string;
  tabs: EditorTab[];
  activeTabPath: string | null;
  editorInstance: any | null;
}

export interface WorkspaceFolder {
  path: string;
  name: string;
}

interface WorkspaceState {
  /** Every open root folder (multi-root workspaces). `fileTree` always holds one wrapper FileNode per entry; FileTree.tsx renders a root header row only when there's more than one, matching VS Code. */
  workspaceFolders: WorkspaceFolder[];
  /** Which open folder single-root UI (status bar, "New File" defaulting to a root, etc.) targets by default — code needing multi-root awareness (GitPanel, agent sandbox) uses an explicit dir instead. */
  activeFolderPath: string | null;
  /** Mirror of workspaceFolders.find(f => f.path === activeFolderPath) — see activeFolderPath's doc comment. Never set directly. */
  workspacePath: string | null;
  workspaceName: string | null;
  fileTree: FileNode[];
  groups: EditorGroup[];
  /** Which group keyboard shortcuts / command-palette actions / "open a synthetic tab" helpers target by default. */
  activeGroupId: string;
  /** Mirrors of the active group's tabs/activeTabPath/editorInstance, kept in sync by every action below so pre-split-editor call sites keep working unchanged. Never set these directly — recomputed from `groups`/`activeGroupId`. */
  openTabs: EditorTab[];
  activeTabPath: string | null;
  activeEditorInstance: any | null;
  isQuickOpenOpen: boolean;
  /** Workspace Trust — null until the trust check/prompt resolves. AiService independently re-checks the persisted DB value, so this in-memory copy is never the sole gate (see aiService.ts's agentQuery()). */
  workspaceTrustState: 'trusted' | 'restricted' | null;

  // Actions
  /** Replaces the entire workspace with just this one folder — the existing "Open Folder" entry point. */
  setWorkspace: (name: string, path: string) => void;
  /** Adds a folder alongside whatever's already open — "Add Folder to Workspace". Becomes the active folder only if it's the first one (opening into an empty workspace). */
  addFolderToWorkspace: (path: string, name: string) => Promise<void>;
  /** Removes a folder from the workspace (closing its open tabs first) — closing the last one resets to the empty-workspace state. */
  removeFolderFromWorkspace: (path: string) => void;
  setActiveFolder: (path: string) => void;
  /** Writes the current workspaceFolders array to a .sde-workspace JSON file (native "Save As" dialog). No-ops if no workspace is open. */
  saveWorkspaceAs: () => Promise<void>;
  /** Reads a .sde-workspace JSON file (native "Open" dialog) and restores every folder it lists — the first via setWorkspace, the rest via addFolderToWorkspace, matching how a fresh multi-root workspace is normally built up one folder at a time. */
  openWorkspaceFile: () => Promise<void>;
  /** Explicitly trusts the currently open folder — the status bar's Restricted Mode indicator calls this. */
  trustCurrentWorkspace: () => Promise<void>;
  setFileTree: (tree: FileNode[]) => void;
  toggleFolder: (folderPath: string) => Promise<void>;
  openFile: (filePath: string, name: string, groupId?: string) => Promise<void>;
  openFileAtLocation: (filePath: string, name: string, line: number, column: number, groupId?: string) => Promise<void>;
  /** skipUnsavedCheck is for callers that already have their own reason a dirty-check doesn't apply — e.g. agent.ts's accept-a-proposed-delete flow, where the file is already gone from disk. */
  closeFile: (filePath: string, options?: { skipUnsavedCheck?: boolean; groupId?: string }) => Promise<void>;
  setActiveTab: (filePath: string, groupId?: string) => void;
  updateTabContent: (filePath: string, newContent: string, groupId?: string) => void;
  /** Like updateTabContent, but sets isDirty explicitly and never triggers auto-save — for programmatic content sync (AI working-set accept/reject/discard), not user typing. Applies to every group with this path open. */
  setTabContent: (filePath: string, content: string, isDirty: boolean) => void;
  saveTab: (filePath: string, groupId?: string) => Promise<void>;
  saveActiveTab: () => Promise<void>;
  openSettingsTab: (tabType: 'settings' | 'shortcuts') => void;
  openExtensionDetailsTab: (extensionId: string, name: string) => void;
  openCreateExtensionTab: (opts?: { templateType?: 'theme' | 'snippets'; sourceLanguageId?: string }) => void;
  openRepoOverviewTab: () => void;
  openCommitDetailsTab: (commit: GitCommit) => void;
  openCodeHotspotsTab: () => void;
  openBranchComparisonTab: () => void;
  openGitGraphTab: () => void;
  /** General-purpose "open or focus an arbitrary tab" — used by callers (git.ts's diff-view tabs) that build their own EditorTab shape instead of one of the named helpers above. */
  openSyntheticTab: (tab: EditorTab, groupId?: string) => void;
  /** Local History — opens the snapshot list for one file (FileTree's "Show Local History" context-menu entry). */
  openLocalHistoryTab: (filePath: string, workspacePath: string) => void;
  /** Opens a read-only diff of one Local History snapshot against the file's current on-disk content. */
  openLocalHistorySnapshotDiff: (snapshotId: string, filePath: string, label: string) => Promise<void>;
  /** Opens a rendered-HTML markdown preview in a split pane alongside the normal editable tab — never replaces it, matching "Open Preview" conventions elsewhere. Focuses the existing preview tab if already open. */
  openMarkdownPreview: (filePath: string, groupId?: string) => void;
  /** Opens the 3-pane (incoming | result | current) conflict resolution view for one file. Focuses the existing merge-editor tab if already open. */
  openMergeEditorTab: (filePath: string) => void;
  /** Opens an in-app browser tab pointed at `url` (e.g. from PortsPanel's "Open in App") — focuses the existing tab for that exact URL if already open, same dedup convention as openLocalHistoryTab/openMergeEditorTab. */
  openBrowserPreviewTab: (url: string) => void;
  /** Opens the detail view for a GitHub PR or Issue (GitHubPanel's list rows). Focuses the existing tab for that exact number/kind if already open. */
  openGitHubItemTab: (number: number, isPR: boolean, title: string) => void;
  /** Opens a new saved Search Editor tab from SearchPanel's "Open as Search Editor" — always a fresh tab (not deduped), matching VS Code's "each click is a new snapshot document" behavior rather than the single-focus convention every other synthetic tab uses. */
  openSearchEditorTab: (query: string, options: SearchInFilesOptions, documentText: string) => void;
  /** Opens (or refocuses) the single Rename Symbol (Preview) tab — one in-flight preview at a time, so a new rename replaces rather than stacks. */
  openBulkRenameTab: () => void;
  /** Opens a new multibuffer tab from a caller-supplied excerpt list (e.g. SearchPanel's "Open as Multibuffer") — always fresh, same reasoning as openSearchEditorTab. */
  openMultibufferTab: (title: string, excerpts: MultibufferExcerptSource[]) => void;
  refreshFileTree: () => Promise<void>;
  refreshFolder: (folderPath: string) => Promise<void>;
  setActiveEditorInstance: (editor: any, groupId?: string) => void;
  setQuickOpenOpen: (open: boolean) => void;
  collapseAllFolders: () => void;

  // Split editor groups
  /** Duplicates the given group's (default: active group) active tab into a new group to its right, and focuses it. No-op if the source group has no active tab. */
  splitEditorGroup: (groupId?: string) => void;
  /** Closes every tab in the group (respecting each one's dirty-check) then removes it. Never closes the last remaining group. */
  closeEditorGroup: (groupId: string) => Promise<void>;
  focusEditorGroup: (groupId: string) => void;
  /** Moves an open tab from one group to another (drag-to-split/drag-to-merge). Auto-collapses the source group if the move empties it, unless it's the last group. */
  moveTabToGroup: (filePath: string, fromGroupId: string, toGroupId: string) => void;

  // Inline Node Creation State
  lastSelectedFolderPath: string | null;
  creatingNode: { type: 'file' | 'folder'; parentPath: string } | null;
  startCreatingNode: (type: 'file' | 'folder') => void;
  cancelCreatingNode: () => void;
  commitCreatingNode: (name: string) => Promise<void>;

  // Explorer context menu actions
  deleteNode: (targetPath: string) => Promise<void>;
  renameNode: (targetPath: string, newName: string) => Promise<void>;
  revealInExplorer: (targetPath: string) => Promise<void>;
  renamingPath: string | null;
  startRenamingNode: (targetPath: string) => void;
  cancelRenamingNode: () => void;

  indexWorkspace: () => Promise<void>;

  // Snippets
  openLanguageSnippetFile: (languageId: string) => Promise<void>;
}

// Keyed per-file: a single shared timer would let editing file B cancel file A's pending auto-save without ever rescheduling it.
const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Debounces the Code Map's per-file re-index so a burst of rapid saves to the same file triggers one reindexFile call, not one per save.
const reindexDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const REINDEX_DEBOUNCE_MS = 400;

const scheduleFileReindex = (projectId: string, workspacePath: string, filePath: string) => {
  const api = window.api;
  if (!api?.reindexFile) return;
  const existing = reindexDebounceTimers.get(filePath);
  if (existing) clearTimeout(existing);
  reindexDebounceTimers.set(
    filePath,
    setTimeout(() => {
      reindexDebounceTimers.delete(filePath);
      api.reindexFile(projectId, workspacePath, filePath).catch((err) => console.error('Failed to reindex file:', err));
    }, REINDEX_DEBOUNCE_MS),
  );
};

const updateNodeInTree = (
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => Partial<FileNode> | Promise<Partial<FileNode>>
): Promise<FileNode[]> => {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.path === targetPath) {
        const updates = await updater(node);
        return { ...node, ...updates };
      }
      if (node.children) {
        const updatedChildren = await updateNodeInTree(node.children, targetPath, updater);
        return { ...node, children: updatedChildren };
      }
      return node;
    })
  );
};

const normalizePath = (p: string) => p.replace(/\\/g, '/');

const findNodeInTree = (nodes: FileNode[], targetPath: string): FileNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
};

const normalizeTreePaths = (nodes: FileNode[]): FileNode[] => {
  return nodes.map((node) => ({
    ...node,
    path: normalizePath(node.path),
    children: node.children ? normalizeTreePaths(node.children) : undefined,
  }));
};

const makeGroupId = () => 'group_' + Math.random().toString(36).slice(2, 9);

/** Recomputes the active-group mirror fields — pass the result straight into `set(...)` after any change to `groups`/`activeGroupId`. */
const mirrorFields = (groups: EditorGroup[], activeGroupId: string) => {
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  return {
    groups,
    activeGroupId: activeGroup?.id ?? activeGroupId,
    openTabs: activeGroup?.tabs ?? [],
    activeTabPath: activeGroup?.activeTabPath ?? null,
    activeEditorInstance: activeGroup?.editorInstance ?? null,
  };
};

const sortFileNodes = (items: FileNode[]): FileNode[] =>
  [...items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Shared by the 7 named openXTab helpers below and openSyntheticTab — "focus it if already open, else append and focus." */
  const openOrFocusTab = (path: string, makeTab: () => EditorTab, groupId?: string) => {
    const targetGroupId = groupId ?? get().activeGroupId;
    const groups = get().groups;
    const group = groups.find((g) => g.id === targetGroupId);
    if (!group) return;
    const existing = group.tabs.find((t) => t.path === path);
    const nextGroups = existing
      ? groups.map((g) => (g.id === targetGroupId ? { ...g, activeTabPath: path } : g))
      : groups.map((g) => (g.id === targetGroupId ? { ...g, tabs: [...g.tabs, makeTab()], activeTabPath: path } : g));
    set(mirrorFields(nextGroups, targetGroupId));
  };

  /** Is `path` exactly one of the open workspace folders' roots (not a subfolder within one)? */
  const isWorkspaceRootPath = (path: string) => get().workspaceFolders.some((f) => f.path === path);

  /** One-time Workspace Trust check/prompt for a folder that just joined the workspace; every folder gets its own persisted trust decision. Fire-and-forget. */
  const resolveFolderTrust = (normPath: string) => {
    (async () => {
      const trustApi = window.api;
      if (!trustApi?.getProjectTrust) return;
      const existing = await trustApi.getProjectTrust(normPath);
      if (!get().workspaceFolders.some((f) => f.path === normPath)) return; // folder was removed while awaiting
      const applyIfStillActive = (state: 'trusted' | 'restricted') => {
        if (get().activeFolderPath === normPath) set({ workspaceTrustState: state });
      };
      if (existing !== null) {
        applyIfStillActive(existing);
        return;
      }
      const trusted = await customConfirm(
        'Do you trust the authors of the files in this folder?\n\nSDE Code Agent Mode needs your explicit trust before it can edit files or run terminal commands in this folder. You can always change this later from the status bar.',
        { title: 'Workspace Trust', confirmLabel: 'Yes, I Trust This Folder', cancelLabel: "No, Keep Restricted" },
      );
      const resolved: 'trusted' | 'restricted' = trusted ? 'trusted' : 'restricted';
      await trustApi.setProjectTrust?.(normPath, resolved);
      applyIfStillActive(resolved);
    })();
  };

  const initialGroupId = makeGroupId();

  return {
  workspaceFolders: [],
  activeFolderPath: null,
  workspacePath: null,
  workspaceName: null,
  fileTree: [],
  groups: [{ id: initialGroupId, tabs: [], activeTabPath: null, editorInstance: null }],
  activeGroupId: initialGroupId,
  openTabs: [],
  activeTabPath: null,
  activeEditorInstance: null,
  isQuickOpenOpen: false,
  lastSelectedFolderPath: null,
  creatingNode: null,
  renamingPath: null,
  workspaceTrustState: null,

  setWorkspace: (name, path) => {
    useTerminalStore.getState().closeAllTerminals();

    const normPath = normalizePath(path);
    const freshGroupId = makeGroupId();
    const rootNode: FileNode = { name, path: normPath, isDirectory: true, isOpen: true, children: [] };
    set({
      workspaceFolders: [{ path: normPath, name }],
      activeFolderPath: normPath,
      workspaceName: name,
      workspacePath: normPath,
      fileTree: [rootNode],
      ...mirrorFields([{ id: freshGroupId, tabs: [], activeTabPath: null, editorInstance: null }], freshGroupId),
      workspaceTrustState: null,
    });
    useGitStore.getState().resetGitStatus();
    resolveFolderTrust(normPath);

    const api = window.api;
    if (api && api.readDir) {
      api.readDir(normPath).then((items: any[]) => {
        const sorted = sortFileNodes(normalizeTreePaths(items));
        set({ fileTree: get().fileTree.map((n) => (n.path === normPath ? { ...n, children: sorted } : n)) });
      });
    }
    useGitStore.getState().loadGitStatus();

    get().indexWorkspace();

    useTerminalStore.getState().toggleTerminalPanel(true);
    useTerminalStore.getState().createNewTerminal();
  },

  addFolderToWorkspace: async (path, name) => {
    const normPath = normalizePath(path);
    if (get().workspaceFolders.some((f) => f.path === normPath)) {
      get().setActiveFolder(normPath);
      return;
    }

    const openingIntoEmptyWorkspace = get().workspaceFolders.length === 0;
    let rootNode: FileNode = { name, path: normPath, isDirectory: true, isOpen: true, children: [] };
    const api = window.api;
    if (api?.readDir) {
      try {
        const items = await api.readDir(normPath);
        rootNode = { ...rootNode, children: sortFileNodes(normalizeTreePaths(items)) };
      } catch (err) {
        console.error('Failed to read folder for workspace:', err);
      }
    }

    set({
      workspaceFolders: [...get().workspaceFolders, { path: normPath, name }],
      fileTree: [...get().fileTree, rootNode],
    });
    resolveFolderTrust(normPath);

    if (openingIntoEmptyWorkspace) {
      get().setActiveFolder(normPath);
      useTerminalStore.getState().toggleTerminalPanel(true);
      useTerminalStore.getState().createNewTerminal();
    }

    if (api?.indexProject) {
      try {
        const { updateItemText } = useStatusBarStore.getState();
        const symbolCount = await api.indexProject(name || 'default_proj', normPath);
        updateItemText('project-indexer', `Indexing: ${symbolCount} Symbols`);
      } catch (err) {
        console.error('Indexing failed for new folder:', err);
      }
    }
  },

  removeFolderFromWorkspace: (path) => {
    const normPath = normalizePath(path);
    const folders = get().workspaceFolders;
    if (!folders.some((f) => f.path === normPath)) return;

    // Close any open tab under this folder, across every group — it's no
    // longer part of the workspace once removed.
    get().groups.forEach((group) => {
      group.tabs
        .filter((t) => t.path === normPath || t.path.startsWith(`${normPath}/`))
        .forEach((t) => get().closeFile(t.path, { groupId: group.id, skipUnsavedCheck: true }));
    });

    const remaining = folders.filter((f) => f.path !== normPath);
    const nextFileTree = get().fileTree.filter((n) => n.path !== normPath);

    if (remaining.length === 0) {
      const freshGroupId = makeGroupId();
      set({
        workspaceFolders: [],
        activeFolderPath: null,
        workspacePath: null,
        workspaceName: null,
        fileTree: [],
        workspaceTrustState: null,
        ...mirrorFields([{ id: freshGroupId, tabs: [], activeTabPath: null, editorInstance: null }], freshGroupId),
      });
      useGitStore.getState().resetGitStatus();
      return;
    }

    set({ workspaceFolders: remaining, fileTree: nextFileTree });
    if (get().activeFolderPath === normPath) {
      get().setActiveFolder(remaining[0].path);
    }
  },

  setActiveFolder: (path) => {
    const folder = get().workspaceFolders.find((f) => f.path === path);
    if (!folder) return;
    set({ activeFolderPath: folder.path, workspacePath: folder.path, workspaceName: folder.name, workspaceTrustState: null });
    useGitStore.getState().loadGitStatus();
    // Re-derive trust for the newly-active folder rather than re-prompting — it was already resolved when the folder joined; this just re-syncs the mirror.
    (async () => {
      const trustApi = window.api;
      if (!trustApi?.getProjectTrust) return;
      const state = await trustApi.getProjectTrust(folder.path);
      if (get().activeFolderPath === folder.path) set({ workspaceTrustState: state });
    })();
  },

  saveWorkspaceAs: async () => {
    const api = window.api;
    const folders = get().workspaceFolders;
    if (!api || folders.length === 0) return;
    try {
      const targetPath = await api.showSaveWorkspaceDialog?.();
      if (!targetPath) return;
      await api.writeFile(targetPath, serializeWorkspaceFile(folders));
    } catch (err) {
      console.error('Failed to save workspace file:', err);
    }
  },

  openWorkspaceFile: async () => {
    const api = window.api;
    if (!api) return;
    try {
      const targetPath = await api.showOpenWorkspaceDialog?.();
      if (!targetPath) return;
      const raw = await api.readFile(targetPath);
      const folders = parseWorkspaceFile(raw);
      if (folders.length === 0) return;

      get().setWorkspace(folders[0].name, folders[0].path);
      for (const folder of folders.slice(1)) {
        await get().addFolderToWorkspace(folder.path, folder.name);
      }
    } catch (err) {
      console.error('Failed to open workspace file:', err);
    }
  },

  trustCurrentWorkspace: async () => {
    const path = get().workspacePath;
    const api = window.api;
    if (!path || !api?.setProjectTrust) return;
    await api.setProjectTrust(path, 'trusted');
    if (get().workspacePath === path) set({ workspaceTrustState: 'trusted' });
  },

  setFileTree: (tree) => set({ fileTree: tree }),

  toggleFolder: async (folderPath) => {
    const normFolderPath = normalizePath(folderPath);
    set({ lastSelectedFolderPath: normFolderPath });
    const api = window.api;
    if (!api) return;

    const currentTree = get().fileTree;

    const updatedTree = await updateNodeInTree(currentTree, normFolderPath, async (node) => {
      const nextIsOpen = !node.isOpen;
      let children = node.children;

      if (nextIsOpen && (!children || children.length === 0)) {
        try {
          const items = await api.readDir(normFolderPath);
          const sorted = items.sort((a: any, b: any) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
          children = normalizeTreePaths(sorted);
        } catch (err) {
          console.error('Failed to read subfolder:', err);
        }
      }

      return { isOpen: nextIsOpen, children };
    });

    set({ fileTree: updatedTree });
  },

  openFile: async (filePath, name, groupId) => {
    const api = window.api;
    if (!api) return;

    const normFilePath = normalizePath(filePath);
    const targetGroupId = groupId ?? get().activeGroupId;
    const group = get().groups.find((g) => g.id === targetGroupId);
    if (!group) return;
    const existing = group.tabs.find((t) => t.path === normFilePath);

    if (existing) {
      set(mirrorFields(get().groups.map((g) => (g.id === targetGroupId ? { ...g, activeTabPath: normFilePath } : g)), targetGroupId));
      return;
    }

    // Images are never text-read — an <img> tag loads the file:// URL directly; decoding binary image bytes as UTF-8 (api.readFile) would corrupt them.
    if (isImagePath(normFilePath)) {
      const imageTab: EditorTab = { name, path: normFilePath, content: '', isDirty: false, isImagePreview: true };
      const nextGroups = get().groups.map((g) =>
        g.id === targetGroupId ? { ...g, tabs: [...g.tabs, imageTab], activeTabPath: normFilePath } : g,
      );
      set(mirrorFields(nextGroups, targetGroupId));
      return;
    }

    // Same never-text-read reasoning as images above — audio/video goes straight to a native element via a file:// URL, never api.readFile's text path.
    if (isAudioPath(normFilePath) || isVideoPath(normFilePath)) {
      const isAudio = isAudioPath(normFilePath);
      const mediaTab: EditorTab = {
        name,
        path: normFilePath,
        content: '',
        isDirty: false,
        ...(isAudio ? { isAudioPreview: true } : { isVideoPreview: true }),
      };
      const nextGroups = get().groups.map((g) =>
        g.id === targetGroupId ? { ...g, tabs: [...g.tabs, mediaTab], activeTabPath: normFilePath } : g,
      );
      set(mirrorFields(nextGroups, targetGroupId));
      return;
    }

    try {
      const content = await api.readFile(normFilePath);
      const newTab: EditorTab = {
        name,
        path: normFilePath,
        content,
        isDirty: false,
        ...(isNotebookPath(normFilePath) ? { isNotebook: true } : {}),
      };

      // Re-read groups after the await — state could have changed while readFile was in flight.
      const nextGroups = get().groups.map((g) =>
        g.id === targetGroupId ? { ...g, tabs: [...g.tabs, newTab], activeTabPath: normFilePath } : g,
      );
      set(mirrorFields(nextGroups, targetGroupId));
      if (isLspManagedFile(normFilePath)) notifyFileOpened(normFilePath, content);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  },

  // Used by the Problems panel for "open + jump to a location". The short delay waits for Monaco's internal model swap to settle before reveal/setPosition, same pattern as TerminalArea.tsx's fit-after-tab-change.
  openFileAtLocation: async (filePath, name, line, column, groupId) => {
    const targetGroupId = groupId ?? get().activeGroupId;
    await get().openFile(filePath, name, targetGroupId);
    setTimeout(() => {
      const editor = get().groups.find((g) => g.id === targetGroupId)?.editorInstance;
      if (!editor) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    }, 80);
  },

  closeFile: async (filePath, options) => {
    const targetGroupId = options?.groupId ?? get().activeGroupId;
    const group = get().groups.find((g) => g.id === targetGroupId);
    const tab = group?.tabs.find((t) => t.path === filePath);

    if (tab?.isDirty && !options?.skipUnsavedCheck) {
      const choice = await promptUnsavedChanges(tab.name);
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await get().saveTab(filePath, targetGroupId);
      }
    }

    // Re-read after the await above — state (including whether this tab or
    // group is still around at all) could have changed while the prompt was showing.
    const groups = get().groups;
    const idx = groups.findIndex((g) => g.id === targetGroupId);
    if (idx === -1) return;
    const current = groups[idx];
    const nextTabs = current.tabs.filter((t) => t.path !== filePath);
    let nextActive = current.activeTabPath;
    if (nextActive === filePath) {
      nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].path : null;
    }

    let nextGroups = groups.map((g, i) => (i === idx ? { ...g, tabs: nextTabs, activeTabPath: nextActive } : g));
    let nextActiveGroupId = get().activeGroupId;

    // Auto-collapse an emptied split group — never the last remaining one.
    if (nextTabs.length === 0 && nextGroups.length > 1) {
      nextGroups = nextGroups.filter((g) => g.id !== targetGroupId);
      if (nextActiveGroupId === targetGroupId) {
        nextActiveGroupId = nextGroups[Math.max(0, idx - 1)]?.id ?? nextGroups[0].id;
      }
    }

    set(mirrorFields(nextGroups, nextActiveGroupId));
    const stillOpenElsewhere = nextGroups.some((g) => g.tabs.some((t) => t.path === filePath));
    // Only tell the language server the document closed once it's gone from every group — a split pane can show the same file twice.
    if (isLspManagedFile(filePath) && !stillOpenElsewhere) {
      notifyFileClosed(filePath);
    }
    // Same "gone from every group" gating — stopping the kernel while a split pane still shows this notebook would pull the rug out from under it.
    if (tab?.isNotebook && !stillOpenElsewhere) {
      useNotebookStore.getState().closeNotebook(filePath);
    }
  },

  setActiveTab: (filePath, groupId) => {
    // Selecting a tab also focuses the group it lives in — matches clicking
    // a tab in an inactive split pane in real multi-pane editors.
    const targetGroupId = groupId ?? get().activeGroupId;
    const nextGroups = get().groups.map((g) => (g.id === targetGroupId ? { ...g, activeTabPath: filePath } : g));
    set(mirrorFields(nextGroups, targetGroupId));
  },

  updateTabContent: (filePath, newContent, groupId) => {
    const groups = get().groups;
    const targetGroupId = groupId ?? get().activeGroupId;
    const hasInTarget = groups.find((g) => g.id === targetGroupId)?.tabs.some((t) => t.path === filePath);
    // Falls back to every group containing this path if the caller doesn't know which pane — e.g. AssistantPanel's "apply to editor" flow.
    const affectedIds = hasInTarget ? [targetGroupId] : groups.filter((g) => g.tabs.some((t) => t.path === filePath)).map((g) => g.id);

    const nextGroups = groups.map((g) =>
      affectedIds.includes(g.id)
        ? { ...g, tabs: g.tabs.map((t) => (t.path === filePath ? { ...t, content: newContent, isDirty: true } : t)) }
        : g,
    );
    set(mirrorFields(nextGroups, get().activeGroupId));
    if (isLspManagedFile(filePath)) notifyFileChanged(filePath, newContent);

    if (useFeatureFlagsStore.getState().isFlagEnabled('auto-save')) {
      const existing = autoSaveTimers.get(filePath);
      if (existing) clearTimeout(existing);
      autoSaveTimers.set(
        filePath,
        setTimeout(() => {
          autoSaveTimers.delete(filePath);
          get().saveTab(filePath, affectedIds[0]);
        }, 1000),
      );
    }
  },

  setTabContent: (filePath, content, isDirty) => {
    const groups = get().groups;
    const nextGroups = groups.map((g) =>
      g.tabs.some((t) => t.path === filePath)
        ? { ...g, tabs: g.tabs.map((t) => (t.path === filePath ? { ...t, content, isDirty } : t)) }
        : g,
    );
    set(mirrorFields(nextGroups, get().activeGroupId));
  },

  saveTab: async (filePath, groupId) => {
    const api = window.api;
    if (!api || !filePath) return;

    const targetGroupId = groupId ?? get().activeGroupId;
    const groups = get().groups;
    const group =
      groups.find((g) => g.id === targetGroupId && g.tabs.some((t) => t.path === filePath)) ??
      groups.find((g) => g.tabs.some((t) => t.path === filePath));
    if (!group) return;
    const tab = group.tabs.find((t) => t.path === filePath)!;
    if (!tab.isDirty) return;

    try {
      await api.writeFile(filePath, tab.content);
      // Only the saved group's tab is marked clean — an independently-edited copy in another group correctly stays dirty.
      const nextGroups = get().groups.map((g) =>
        g.id === group.id ? { ...g, tabs: g.tabs.map((t) => (t.path === filePath ? { ...t, isDirty: false } : t)) } : g,
      );
      set(mirrorFields(nextGroups, get().activeGroupId));
      // Reload git status on save since file changes might affect Git
      useGitStore.getState().loadGitStatus();

      // Local History — fire-and-forget, scoped to the owning folder (multi-root safe). saveFileSnapshot no-ops server-side if content is unchanged, so no-op auto-saves are cheap.
      const owningFolder = get().workspaceFolders.find((f) => filePath === f.path || filePath.startsWith(f.path + '/') || filePath.startsWith(f.path + '\\'));
      if (owningFolder) {
        api.saveFileSnapshot?.(owningFolder.path, filePath, tab.content).catch((err) => console.error('Failed to save file snapshot:', err));
        // Keep the Code Map's impact graph from going stale between full re-indexes (which today only run on folder-open).
        scheduleFileReindex(owningFolder.name || 'default_proj', owningFolder.path, filePath);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  },

  saveActiveTab: async () => {
    const activeGroupId = get().activeGroupId;
    const activePath = get().groups.find((g) => g.id === activeGroupId)?.activeTabPath;
    if (activePath) {
      await get().saveTab(activePath, activeGroupId);
    }
  },

  openSyntheticTab: (tab, groupId) => {
    openOrFocusTab(tab.path, () => tab, groupId);
  },

  openLocalHistoryTab: (filePath, workspacePath) => {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    openOrFocusTab(`local-history:${filePath}`, () => ({
      name: `Local History: ${name}`,
      path: `local-history:${filePath}`,
      content: '',
      isDirty: false,
      isLocalHistory: true,
      localHistoryFilePath: filePath,
      localHistoryWorkspacePath: workspacePath,
    }));
  },

  openLocalHistorySnapshotDiff: async (snapshotId, filePath, label) => {
    const api = window.api;
    if (!api) return;

    const diffPath = `localhistorydiff:${snapshotId}:${filePath}`;
    if (get().openTabs.some((t) => t.path === diffPath)) {
      get().setActiveTab(diffPath);
      return;
    }

    try {
      const [snapshotContent, currentContent] = await Promise.all([
        api.getFileSnapshotContent(snapshotId),
        api.readFile(filePath).catch(() => ''),
      ]);
      const name = filePath.split(/[\\/]/).pop() || filePath;
      const newTab: EditorTab = {
        name: `Local History: ${name} (${label})`,
        path: diffPath,
        content: currentContent,
        originalContent: snapshotContent ?? '',
        isDirty: false,
        isDiff: true,
      };
      get().openSyntheticTab(newTab);
    } catch (err) {
      console.error('Failed to open Local History snapshot diff:', err);
    }
  },

  openMarkdownPreview: (filePath, groupId) => {
    const previewPath = `markdown-preview:${filePath}`;
    const groups = get().groups;

    // Already open somewhere (any group) — just focus it, matching every
    // other synthetic-tab opener's dedup behavior in this file.
    const existingGroup = groups.find((g) => g.tabs.some((t) => t.path === previewPath));
    if (existingGroup) {
      set(mirrorFields(groups.map((g) => (g.id === existingGroup.id ? { ...g, activeTabPath: previewPath } : g)), existingGroup.id));
      return;
    }

    // Unlike splitEditorGroup (which duplicates the active tab), this always opens a synthetic preview tab in the new group, alongside the real editable source.
    const sourceGroupId = groupId ?? get().activeGroupId;
    const sourceIdx = groups.findIndex((g) => g.id === sourceGroupId);
    if (sourceIdx === -1) return;

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const previewTab: EditorTab = {
      name: `Preview: ${fileName}`,
      path: previewPath,
      content: '',
      isDirty: false,
      isMarkdownPreview: true,
      markdownSourcePath: filePath,
    };
    const newGroup: EditorGroup = {
      id: makeGroupId(),
      tabs: [previewTab],
      activeTabPath: previewPath,
      editorInstance: null,
    };
    const nextGroups = [...groups.slice(0, sourceIdx + 1), newGroup, ...groups.slice(sourceIdx + 1)];
    set(mirrorFields(nextGroups, newGroup.id));
  },

  openMergeEditorTab: (filePath) => {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    openOrFocusTab(`merge-editor:${filePath}`, () => ({
      name: `Merge: ${name}`,
      path: `merge-editor:${filePath}`,
      content: '',
      isDirty: false,
      isMergeEditor: true,
      mergeEditorFilePath: filePath,
    }));
  },

  openBrowserPreviewTab: (url) => {
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      // Not a fully-qualified URL (e.g. missing scheme) — fall back to the raw string for the tab label.
    }
    openOrFocusTab(`browser-preview:${url}`, () => ({
      name: `Browser: ${host}`,
      path: `browser-preview:${url}`,
      content: '',
      isDirty: false,
      isBrowserPreview: true,
      browserPreviewUrl: url,
    }));
  },

  openGitHubItemTab: (number, isPR, title) => {
    const kind = isPR ? 'pr' : 'issue';
    const itemPath = `github-item:${kind}:${number}`;
    openOrFocusTab(itemPath, () => ({
      name: `${isPR ? 'PR' : 'Issue'} #${number}: ${title}`,
      path: itemPath,
      content: '',
      isDirty: false,
      isGitHubItem: true,
      gitHubItemNumber: number,
      gitHubItemIsPR: isPR,
    }));
  },

  openSearchEditorTab: (query, options, documentText) => {
    const searchPath = `search-editor:${Date.now()}`;
    openOrFocusTab(searchPath, () => ({
      name: `Search: ${query}`,
      path: searchPath,
      content: documentText,
      isDirty: false,
      isSearchEditor: true,
      searchEditorQuery: query,
      searchEditorOptions: options,
    }));
  },

  openBulkRenameTab: () => {
    const bulkRenamePath = 'bulk-rename-preview';
    openOrFocusTab(bulkRenamePath, () => ({
      name: 'Rename Preview',
      path: bulkRenamePath,
      content: '',
      isDirty: false,
      isBulkRename: true,
    }));
  },

  openMultibufferTab: (title, excerpts) => {
    const multibufferPath = `multibuffer:${Date.now()}`;
    // Registered before opening the tab — MultibufferPanel reads it on mount, so it must already be there.
    useMultibufferStore.getState().registerMultibuffer(multibufferPath, excerpts);
    openOrFocusTab(multibufferPath, () => ({
      name: `Multibuffer: ${title}`,
      path: multibufferPath,
      content: '',
      isDirty: false,
      isMultibuffer: true,
    }));
  },

  openSettingsTab: (tabType) => {
    const settingsPath = `settings:${tabType}`;
    const tabName = tabType === 'shortcuts' ? 'Keyboard Shortcuts' : 'Settings';
    openOrFocusTab(settingsPath, () => ({
      name: tabName,
      path: settingsPath,
      content: '',
      isDirty: false,
      isSettings: true,
      settingsType: tabType,
    }));
  },

  openExtensionDetailsTab: (extensionId, name) => {
    const extPath = `extension:${extensionId}`;
    openOrFocusTab(extPath, () => ({
      name: `Extension: ${name}`,
      path: extPath,
      content: '',
      isDirty: false,
      isExtensionDetails: true,
      extensionId: extensionId,
    }));
  },

  openCreateExtensionTab: (opts) => {
    const templateType = opts?.templateType ?? 'theme';
    const path = templateType === 'snippets' && opts?.sourceLanguageId
      ? `extension:create:snippets:${opts.sourceLanguageId}`
      : 'extension:create';
    openOrFocusTab(path, () => ({
      name: templateType === 'snippets' ? `Publish "${opts!.sourceLanguageId}" Snippets` : 'Create Extension',
      path,
      content: '',
      isDirty: false,
      isCreateExtension: true,
      createExtensionTemplateType: templateType,
      createExtensionSourceLanguageId: opts?.sourceLanguageId,
    }));
  },

  openRepoOverviewTab: () => {
    const repoOverviewPath = 'repo-overview';
    openOrFocusTab(repoOverviewPath, () => ({
      name: 'Repository Overview',
      path: repoOverviewPath,
      content: '',
      isDirty: false,
      isRepoOverview: true,
    }));
  },

  openCommitDetailsTab: (commit) => {
    const commitPath = `commit:${commit.hash}`;
    openOrFocusTab(commitPath, () => ({
      name: `Commit: ${commit.shortHash}`,
      path: commitPath,
      content: '',
      isDirty: false,
      isCommitDetails: true,
      commitHash: commit.hash,
      commitShortHash: commit.shortHash,
      commitMessage: commit.message,
      commitAuthor: commit.author,
      commitDate: commit.date,
    }));
  },

  openCodeHotspotsTab: () => {
    const hotspotsPath = 'code-hotspots';
    openOrFocusTab(hotspotsPath, () => ({
      name: 'Code Hotspots',
      path: hotspotsPath,
      content: '',
      isDirty: false,
      isCodeHotspots: true,
    }));
  },

  openBranchComparisonTab: () => {
    const comparisonPath = 'branch-comparison';
    openOrFocusTab(comparisonPath, () => ({
      name: 'Compare Branches',
      path: comparisonPath,
      content: '',
      isDirty: false,
      isBranchComparison: true,
    }));
  },

  openGitGraphTab: () => {
    const graphPath = 'git-graph';
    openOrFocusTab(graphPath, () => ({
      name: 'Git Graph',
      path: graphPath,
      content: '',
      isDirty: false,
      isGitGraph: true,
    }));
  },

  setActiveEditorInstance: (editor, groupId) => {
    const targetGroupId = groupId ?? get().activeGroupId;
    const nextGroups = get().groups.map((g) => (g.id === targetGroupId ? { ...g, editorInstance: editor } : g));
    set(mirrorFields(nextGroups, get().activeGroupId));
  },
  setQuickOpenOpen: (open) => set({ isQuickOpenOpen: open }),

  splitEditorGroup: (groupId) => {
    const sourceGroupId = groupId ?? get().activeGroupId;
    const groups = get().groups;
    const sourceIdx = groups.findIndex((g) => g.id === sourceGroupId);
    if (sourceIdx === -1) return;
    const source = groups[sourceIdx];
    const activeTab = source.tabs.find((t) => t.path === source.activeTabPath);
    if (!activeTab) return; // nothing open in this group to split

    const newGroup: EditorGroup = {
      id: makeGroupId(),
      tabs: [{ ...activeTab }],
      activeTabPath: activeTab.path,
      editorInstance: null,
    };
    const nextGroups = [...groups.slice(0, sourceIdx + 1), newGroup, ...groups.slice(sourceIdx + 1)];
    set(mirrorFields(nextGroups, newGroup.id));
  },

  closeEditorGroup: async (groupId) => {
    if (get().groups.length <= 1) return; // never close the last group
    const group = get().groups.find((g) => g.id === groupId);
    if (!group) return;

    // closeFile already auto-removes an emptied non-last group and refocuses a neighbor. Iterate a snapshot since closeFile mutates `groups`.
    for (const tab of [...group.tabs]) {
      await get().closeFile(tab.path, { groupId });
    }
  },

  focusEditorGroup: (groupId) => {
    if (!get().groups.some((g) => g.id === groupId)) return;
    set(mirrorFields(get().groups, groupId));
  },

  moveTabToGroup: (filePath, fromGroupId, toGroupId) => {
    if (fromGroupId === toGroupId) {
      set(mirrorFields(get().groups, toGroupId));
      return;
    }
    const groups = get().groups;
    const fromGroup = groups.find((g) => g.id === fromGroupId);
    const tab = fromGroup?.tabs.find((t) => t.path === filePath);
    if (!tab) return;

    let nextGroups = groups.map((g) => {
      if (g.id === fromGroupId) {
        const remaining = g.tabs.filter((t) => t.path !== filePath);
        return {
          ...g,
          tabs: remaining,
          activeTabPath: g.activeTabPath === filePath ? (remaining[remaining.length - 1]?.path ?? null) : g.activeTabPath,
        };
      }
      if (g.id === toGroupId) {
        const already = g.tabs.some((t) => t.path === filePath);
        return already ? { ...g, activeTabPath: filePath } : { ...g, tabs: [...g.tabs, tab], activeTabPath: filePath };
      }
      return g;
    });

    // Auto-collapse the source group if the move emptied it (never the last group).
    const sourceNowEmpty = nextGroups.find((g) => g.id === fromGroupId)?.tabs.length === 0;
    if (sourceNowEmpty && nextGroups.length > 1) {
      nextGroups = nextGroups.filter((g) => g.id !== fromGroupId);
    }

    set(mirrorFields(nextGroups, toGroupId));
  },

  // Refreshes every open root's top-level contents (e.g. after a create/delete or external change). Each root stays a wrapper FileNode; only `children` is replaced.
  refreshFileTree: async () => {
    const folders = get().workspaceFolders;
    if (folders.length === 0) return;
    const api = window.api;
    if (!api?.readDir) return;

    const preserveExpanded = (newItems: FileNode[], oldItems: FileNode[]): FileNode[] => {
      return newItems.map((item) => {
        const old = oldItems.find((o) => o.path === item.path);
        if (old) {
          return {
            ...item,
            isOpen: old.isOpen,
            children: old.children && item.children ? preserveExpanded(item.children, old.children) : item.children || old.children,
          };
        }
        return item;
      });
    };

    const oldRoots = get().fileTree;
    const newRoots = await Promise.all(
      folders.map(async (folder): Promise<FileNode> => {
        const oldRoot = oldRoots.find((r) => r.path === folder.path);
        try {
          const items = await api.readDir(folder.path);
          return {
            name: folder.name,
            path: folder.path,
            isDirectory: true,
            isOpen: oldRoot?.isOpen ?? true,
            children: preserveExpanded(sortFileNodes(normalizeTreePaths(items)), oldRoot?.children ?? []),
          };
        } catch (err) {
          console.error(`Failed to refresh folder ${folder.path}:`, err);
          return oldRoot ?? { name: folder.name, path: folder.path, isDirectory: true, isOpen: true, children: [] };
        }
      }),
    );
    set({ fileTree: newRoots });
  },

  refreshFolder: async (folderPath) => {
    const api = window.api;
    if (!api || !api.readDir) return;

    const normFolderPath = normalizePath(folderPath);

    try {
      const items = await api.readDir(normFolderPath);
      const sorted = items.sort((a: any, b: any) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      const normalizedSorted = normalizeTreePaths(sorted);

      const updateChildrenInTree = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((node) => {
          if (node.path === normFolderPath) {
            const oldChildren = node.children || [];
            const mergedChildren = normalizedSorted.map((newItem) => {
              const oldChild = oldChildren.find((o) => o.path === newItem.path);
              if (oldChild) {
                return { ...newItem, isOpen: oldChild.isOpen, children: oldChild.children };
              }
              return newItem;
            });
            return { ...node, children: mergedChildren };
          }
          if (node.children) {
            return { ...node, children: updateChildrenInTree(node.children) };
          }
          return node;
        });
      };

      set({ fileTree: updateChildrenInTree(get().fileTree) });
    } catch (err) {
      console.error(`Failed to refresh folder ${normFolderPath}:`, err);
    }
  },

  collapseAllFolders: () => {
    const collapseNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes.map((node) => {
        if (node.isDirectory) {
          const children = node.children ? collapseNodes(node.children) : undefined;
          return { ...node, isOpen: false, children };
        }
        return node;
      });
    };
    set({ fileTree: collapseNodes(get().fileTree) });
  },

  startCreatingNode: (type) => {
    const rawParentPath = get().lastSelectedFolderPath || get().workspacePath || '.';
    const parentPath = normalizePath(rawParentPath);
    set({
      creatingNode: { type, parentPath }
    });

    // Expand the parent folder so the inline input is visible
    const tree = get().fileTree;
    const openFolderNode = (nodes: FileNode[]): FileNode[] => {
      return nodes.map((n) => {
        if (n.path === parentPath) {
          return { ...n, isOpen: true };
        }
        if (n.children) {
          return { ...n, children: openFolderNode(n.children) };
        }
        return n;
      });
    };
    if (!isWorkspaceRootPath(parentPath)) {
      set({ fileTree: openFolderNode(tree) });
    }
  },

  cancelCreatingNode: () => {
    set({ creatingNode: null });
  },

  commitCreatingNode: async (name) => {
    const creating = get().creatingNode;
    if (!creating) return;
    set({ creatingNode: null });

    const api = window.api;
    if (!api) return;

    const parentPath = normalizePath(creating.parentPath);
    const filePath = parentPath.endsWith('/')
      ? `${parentPath}${name}`
      : `${parentPath}/${name}`;

    try {
      if (creating.type === 'file') {
        if (api.createFile) {
          await api.createFile(filePath);
          if (isWorkspaceRootPath(parentPath)) {
            await get().refreshFileTree();
          } else {
            await get().refreshFolder(parentPath);
          }
          await get().openFile(filePath, name);
        }
      } else {
        if (api.createDirectory) {
          await api.createDirectory(filePath);
          if (isWorkspaceRootPath(parentPath)) {
            await get().refreshFileTree();
          } else {
            await get().refreshFolder(parentPath);
          }
        }
      }
    } catch (err) {
      console.error('Failed to commit creation:', err);
      customAlert(DIALOG_MESSAGES.workspace.errorCreatingItem(err));
    }
  },

  deleteNode: async (targetPath) => {
    const api = window.api;
    if (!api?.deletePath) return;
    const normPath = normalizePath(targetPath);
    const node = findNodeInTree(get().fileTree, normPath);
    const name = normPath.split('/').pop() || normPath;
    const isDirectory = node?.isDirectory ?? false;

    const confirmed = await customConfirm(
      isDirectory
        ? DIALOG_MESSAGES.workspace.confirmDeleteFolder(name)
        : DIALOG_MESSAGES.workspace.confirmDeleteFile(name),
      { danger: true },
    );
    if (!confirmed) return;

    try {
      await api.deletePath(normPath);

      // Close any open tab for this path (or nested beneath it), in every group. skipUnsavedCheck is required: the file is already gone from disk, so "Save" would silently recreate it.
      get().groups.forEach((group) => {
        group.tabs
          .filter((t) => t.path === normPath || t.path.startsWith(`${normPath}/`))
          .forEach((t) => get().closeFile(t.path, { groupId: group.id, skipUnsavedCheck: true }));
      });

      const parts = normPath.split('/');
      parts.pop();
      const parentPath = parts.join('/');
      if (isWorkspaceRootPath(parentPath) || parentPath === '') {
        await get().refreshFileTree();
      } else {
        await get().refreshFolder(parentPath);
      }
    } catch (err) {
      console.error('Failed to delete node:', err);
      customAlert(DIALOG_MESSAGES.workspace.errorDeletingItem(err));
    }
  },

  renameNode: async (targetPath, newName) => {
    const api = window.api;
    if (!api?.renamePath) return;
    const normPath = normalizePath(targetPath);
    const trimmed = newName.trim();
    if (!trimmed) return;

    const parts = normPath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    if (newPath === normPath) return;

    try {
      await api.renamePath(normPath, newPath);

      // Repoint any open tab for the renamed item (or nested under it) in place instead of closing it, preserving cursor/scroll/dirty state.
      const repointPath = (p: string) =>
        p === normPath ? newPath : p.startsWith(`${normPath}/`) ? newPath + p.slice(normPath.length) : p;

      const nextGroups = get().groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.path === normPath || t.path.startsWith(`${normPath}/`)
          ? { ...t, path: repointPath(t.path), name: t.path === normPath ? trimmed : t.name }
          : t)),
        activeTabPath: g.activeTabPath ? repointPath(g.activeTabPath) : g.activeTabPath,
      }));
      set(mirrorFields(nextGroups, get().activeGroupId));

      if (isWorkspaceRootPath(parentPath) || parentPath === '') {
        await get().refreshFileTree();
      } else {
        await get().refreshFolder(parentPath);
      }
    } catch (err) {
      console.error('Failed to rename node:', err);
      customAlert(DIALOG_MESSAGES.workspace.errorRenamingItem(err));
    }
  },

  revealInExplorer: async (targetPath) => {
    const api = window.api;
    if (!api?.revealInExplorer) return;
    try {
      await api.revealInExplorer(targetPath);
    } catch (err) {
      console.error('Failed to reveal in explorer:', err);
    }
  },

  startRenamingNode: (targetPath) => {
    set({ renamingPath: normalizePath(targetPath) });
  },

  cancelRenamingNode: () => {
    set({ renamingPath: null });
  },

  // Indexes every open folder — each keeps its own project_id (basename) rather than a merged workspace-wide identity, so rules/memory/flags stay scoped per-folder.
  indexWorkspace: async () => {
    const folders = get().workspaceFolders;
    if (folders.length === 0) return;
    const api = window.api;
    if (!api?.indexProject) return;

    const { updateItemText } = useStatusBarStore.getState();
    updateItemText('project-indexer', 'Indexing: Starting...');
    const removeListener = api.onIndexProgress((statusText: string) => {
      updateItemText('project-indexer', statusText);
    });

    try {
      let total = 0;
      for (const folder of folders) {
        const projectId = folder.name || 'default_proj';
        total += await api.indexProject(projectId, folder.path);
      }
      updateItemText('project-indexer', `Indexing: ${total} Symbols`);
    } catch (err) {
      console.error('Indexing failed:', err);
      updateItemText('project-indexer', 'Indexing: Failed');
    } finally {
      removeListener();
    }
  },

  openLanguageSnippetFile: async (languageId) => {
    const api = window.api;
    if (!api?.ensureUserSnippetFile) return;
    const filePath = await api.ensureUserSnippetFile(languageId);
    await get().openFile(filePath, `${languageId}.json`);
  },
  };
});

// Tab Switcher (Ctrl+Tab) MRU tracking — deliberately kept outside Zustand state as a
// plain module-level array updated via subscribe, since it's only read on-demand when
// the switcher opens rather than needing to drive a re-render on every tab focus change.
let tabMru: string[] = [];
useWorkspaceStore.subscribe((state, prevState) => {
  if (state.activeTabPath && state.activeTabPath !== prevState.activeTabPath) {
    tabMru = [state.activeTabPath, ...tabMru.filter((p) => p !== state.activeTabPath)];
  }
  if (state.groups !== prevState.groups) {
    const allOpenPaths = new Set(state.groups.flatMap((g) => g.tabs.map((t) => t.path)));
    tabMru = tabMru.filter((p) => allOpenPaths.has(p));
  }
});

/** MRU-ordered paths for the active group's open tabs — MRU entries first, then any open tabs never yet focused (in tab-bar order). Used by TabSwitcherOverlay. */
export function getTabSwitchOrder(): string[] {
  const openTabs = useWorkspaceStore.getState().openTabs;
  const openPaths = openTabs.map((t) => t.path);
  const openSet = new Set(openPaths);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const p of tabMru) {
    if (openSet.has(p) && !seen.has(p)) { ordered.push(p); seen.add(p); }
  }
  for (const p of openPaths) {
    if (!seen.has(p)) { ordered.push(p); seen.add(p); }
  }
  return ordered;
}
