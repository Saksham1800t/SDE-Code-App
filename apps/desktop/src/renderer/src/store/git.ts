import { create } from 'zustand';
import { GitFile, GitRepoStatus, GitCommit, GitStash, GitBranches, GitRepoStats, GitCommitFile, GitFileHotspot, GitGraphCommit, GitRepoRoot } from '../types/git';
import type { GitDiffResult } from '@sde-code/protocol';
import { useWorkspaceStore, EditorTab } from './workspace';

export type { GitFile, GitRepoStatus, GitCommit, GitStash, GitBranches, GitRepoStats, GitCommitFile, GitFileHotspot, GitGraphCommit, GitRepoRoot };

const GIT_GRAPH_PAGE_SIZE = 300;

export interface GitRepoSummary {
  dir: string;
  name: string;
  status: GitRepoStatus;
}

interface GitState {
  gitRepoStatus: GitRepoStatus | null;
  /** Status for every git repo found across every open workspace folder (including nested ones) — the multi-root GitPanel's "all repos at a glance" list. */
  repoSummaries: GitRepoSummary[];
  gitBranches: GitBranches | null;
  gitStashes: GitStash[];
  repoStats: GitRepoStats | null;
  commitFiles: GitCommitFile[] | null;
  fileHotspots: GitFileHotspot[] | null;
  branchComparison: GitCommitFile[] | null;
  gitGraphCommits: GitGraphCommit[] | null;
  gitGraphHasMore: boolean;
  /** Currently unused (no gitGetMergeStatus caller sets it) — kept rather than dropped since removing dead state is out of scope here. */
  isMerging: boolean;

  // Every action below takes an optional trailing `dir`: omitted falls back to the active workspace folder; passed explicitly targets a specific repo (GitPanel's multi-root selector).
  loadGitStatus: (dir?: string) => Promise<void>;
  /** Populates `repoSummaries` by discovering + fetching status for every repo (root or nested) under every open workspace folder. */
  loadAllRepoSummaries: () => Promise<void>;
  gitInitRepo: (dir?: string) => Promise<void>;
  gitStage: (relativePath: string, dir?: string) => Promise<void>;
  gitUnstage: (relativePath: string, dir?: string) => Promise<void>;
  gitStageAll: (dir?: string) => Promise<void>;
  gitUnstageAll: (dir?: string) => Promise<void>;
  gitDiscard: (relativePath: string, dir?: string) => Promise<void>;
  gitDiscardAll: (dir?: string) => Promise<void>;
  gitCommit: (message: string, dir?: string) => Promise<void>;
  gitCommitAndPush: (message: string, dir?: string) => Promise<void>;
  gitUndoLastCommit: (dir?: string) => Promise<void>;
  gitAmendLastCommit: (message: string, dir?: string) => Promise<void>;
  gitPush: (dir?: string) => Promise<void>;
  gitPull: (dir?: string) => Promise<void>;
  gitFetch: (dir?: string) => Promise<void>;
  gitLoadBranches: (dir?: string) => Promise<void>;
  gitCreateBranch: (name: string, from?: string, dir?: string) => Promise<void>;
  gitCheckoutBranch: (name: string, dir?: string) => Promise<void>;
  gitDeleteBranch: (name: string, force?: boolean, dir?: string) => Promise<void>;
  gitRenameBranch: (oldName: string, newName: string, dir?: string) => Promise<void>;
  gitPublishBranch: (name: string, dir?: string) => Promise<void>;
  gitMergeBranch: (name: string, dir?: string) => Promise<void>;
  gitStashPush: (message?: string, dir?: string) => Promise<void>;
  gitStashPop: (index?: number, dir?: string) => Promise<void>;
  gitStashDrop: (index: number, dir?: string) => Promise<void>;
  gitLoadStashes: (dir?: string) => Promise<void>;
  gitGetStagedDiff: (dir?: string) => Promise<string>;
  gitGetHeatmap: (weeks?: number, dir?: string) => Promise<Record<string, number>>;
  gitLoadRepoStats: (dir?: string) => Promise<void>;
  gitLoadCommitFiles: (hash: string, dir?: string) => Promise<void>;
  gitOpenCommitFileDiff: (hash: string, relativePath: string, name: string, dir?: string) => Promise<void>;
  gitLoadFileHotspots: (dir?: string) => Promise<void>;
  gitGetCommitPatch: (hash: string, dir?: string) => Promise<string>;
  gitLoadBranchComparison: (branchA: string, branchB: string, dir?: string) => Promise<void>;
  gitOpenBranchFileDiff: (branchA: string, branchB: string, relativePath: string, name: string, dir?: string) => Promise<void>;
  gitLoadGitGraph: (reset?: boolean, dir?: string) => Promise<void>;
  /** Fetch-only helpers for the embedded (possibly multi-repo) sidebar graph — explicit `dir`, no global-state mutation; caller owns its own per-repo state. */
  gitDiscoverRepos: (rootDir: string) => Promise<GitRepoRoot[]>;
  gitFetchCommitGraph: (dir: string, limit?: number, skip?: number) => Promise<GitGraphCommit[]>;
  gitFetchCommitFiles: (dir: string, hash: string) => Promise<GitCommitFile[]>;
  /** Same fetch-only shape as gitFetchCommitFiles — used by TimelinePanel and CommitDetailsPanel, neither of which wants the result in global state. */
  gitFetchFileCommitHistory: (dir: string, relativePath: string, limit?: number) => Promise<GitCommit[]>;
  gitFetchCommitFileDiff: (dir: string, hash: string, relativePath: string) => Promise<GitDiffResult>;
  openDiff: (relativePath: string, name: string, dir?: string) => Promise<void>;
  /** Extracted so workspace.ts's setWorkspace() can call it as an action
   * instead of reaching into this store's raw state. */
  resetGitStatus: () => void;
}

export const useGitStore = create<GitState>((set, get) => ({
  gitRepoStatus: null,
  repoSummaries: [],
  gitBranches: null,
  gitStashes: [],
  repoStats: null,
  commitFiles: null,
  fileHotspots: null,
  branchComparison: null,
  gitGraphCommits: null,
  gitGraphHasMore: true,
  isMerging: false,

  loadGitStatus: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      const status = await api.gitStatus(path);
      set({ gitRepoStatus: status });
    } catch (err) {
      console.error('Failed to load git status:', err);
    }
  },

  // Fans gitDiscoverRepos out across every open workspace folder and fetches each discovered repo's status, deduping by path.
  loadAllRepoSummaries: async () => {
    const api = window.api;
    if (!api) return;
    const folders = useWorkspaceStore.getState().workspaceFolders;
    if (folders.length === 0) {
      set({ repoSummaries: [] });
      return;
    }

    try {
      const discovered = (await Promise.all(folders.map((f) => get().gitDiscoverRepos(f.path)))).flat();
      const seen = new Set<string>();
      const repoRoots = discovered.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));

      const summaries = await Promise.all(
        repoRoots.map(async (r): Promise<GitRepoSummary | null> => {
          try {
            const status = await api.gitStatus(r.path);
            return { dir: r.path, name: r.name, status };
          } catch (err) {
            console.error(`Failed to load status for repo ${r.path}:`, err);
            return null;
          }
        }),
      );
      set({ repoSummaries: summaries.filter((s): s is GitRepoSummary => s !== null) });
    } catch (err) {
      console.error('Failed to load repo summaries:', err);
    }
  },

  gitInitRepo: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitInit(path);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to init git repo:', err);
    }
  },

  gitStage: async (relativePath, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitStage(path, relativePath);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to stage file:', err);
    }
  },

  gitUnstage: async (relativePath, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitUnstage(path, relativePath);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to unstage file:', err);
    }
  },

  gitStageAll: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitStageAll(path);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to stage all files:', err);
    }
  },

  gitUnstageAll: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitUnstageAll(path);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to unstage all files:', err);
    }
  },

  gitCommit: async (message, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path || !message.trim()) return;

    try {
      await api.gitCommit(path, message);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to commit changes:', err);
      throw err;
    }
  },

  gitPush: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitPush(path);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to push changes:', err);
      throw err;
    }
  },

  gitPull: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    try {
      await api.gitPull(path);
      await get().loadGitStatus(path);
    } catch (err) {
      console.error('Failed to pull changes:', err);
      throw err;
    }
  },

  openDiff: async (relativePath, name, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    const diffPath = `gitdiff:${relativePath}`;
    if (useWorkspaceStore.getState().openTabs.some((t) => t.path === diffPath)) {
      useWorkspaceStore.getState().setActiveTab(diffPath);
      return;
    }

    try {
      const diffData = await api.gitDiff(path, relativePath);
      const newTab: EditorTab = {
        name: `Diff: ${name}`,
        path: diffPath,
        content: diffData.modified,
        originalContent: diffData.original,
        isDirty: false,
        isDiff: true,
      };

      // Routed through the store action (not a raw setState) so it stays in
      // sync with the active editor group.
      useWorkspaceStore.getState().openSyntheticTab(newTab);
    } catch (err) {
      console.error('Failed to open file diff:', err);
    }
  },

  gitDiscard: async (relativePath, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitDiscardFile(path, relativePath);
      await get().loadGitStatus(path);

      // Discard can restore or remove a file on disk, which the Explorer's cached tree doesn't see (it only listens for its own file actions, not git ones), so refresh whichever level changed.
      const ws = useWorkspaceStore.getState();
      const normWorkspacePath = path.replace(/\\/g, '/');
      const fullPath = `${normWorkspacePath}/${relativePath.replace(/\\/g, '/')}`;
      const parts = fullPath.split('/');
      parts.pop();
      const parentPath = parts.join('/');
      if (parentPath === normWorkspacePath || parentPath === '') {
        await ws.refreshFileTree();
      } else {
        await ws.refreshFolder(parentPath);
      }
    } catch (err: any) {
      console.error('Failed to discard file:', err);
      throw err;
    }
  },

  gitDiscardAll: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitDiscardAll(path);
      await get().loadGitStatus(path);
      // discardAll can touch files anywhere in the tree, so do a full root refresh (preserving expanded folders).
      await useWorkspaceStore.getState().refreshFileTree();
    } catch (err: any) {
      console.error('Failed to discard all changes:', err);
      throw err;
    }
  },

  gitCommitAndPush: async (message, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path || !message.trim()) return;
    try {
      await api.gitCommit(path, message);
      await api.gitPush(path);
      await get().loadGitStatus(path);
    } catch (err: any) {
      console.error('Failed to commit and push:', err);
      throw err;
    }
  },

  gitUndoLastCommit: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitUndoLastCommit(path);
      await get().loadGitStatus(path);
    } catch (err: any) {
      console.error('Failed to undo last commit:', err);
      throw err;
    }
  },

  gitAmendLastCommit: async (message, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitAmendLastCommit(path, message);
      await get().loadGitStatus(path);
    } catch (err: any) {
      console.error('Failed to amend last commit:', err);
      throw err;
    }
  },

  gitFetch: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitFetch(path);
      await get().loadGitStatus(path);
    } catch (err: any) {
      console.error('Failed to fetch:', err);
      throw err;
    }
  },

  gitLoadBranches: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      const branches = await api.gitGetBranches(path);
      set({ gitBranches: branches });
    } catch (err) {
      console.error('Failed to load branches:', err);
    }
  },

  gitCreateBranch: async (name, from, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitCreateBranch(path, name, from);
      await get().loadGitStatus(path);
      await get().gitLoadBranches(path);
    } catch (err: any) {
      console.error('Failed to create branch:', err);
      throw err;
    }
  },

  gitCheckoutBranch: async (name, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitCheckoutBranch(path, name);
      await get().loadGitStatus(path);
      await get().gitLoadBranches(path);
    } catch (err: any) {
      console.error('Failed to checkout branch:', err);
      throw err;
    }
  },

  gitDeleteBranch: async (name, force, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitDeleteBranch(path, name, force);
      await get().gitLoadBranches(path);
    } catch (err: any) {
      console.error('Failed to delete branch:', err);
      throw err;
    }
  },

  gitRenameBranch: async (oldName, newName, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitRenameBranch(path, oldName, newName);
      await get().loadGitStatus(path);
      await get().gitLoadBranches(path);
    } catch (err: any) {
      console.error('Failed to rename branch:', err);
      throw err;
    }
  },

  gitPublishBranch: async (name, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitPublishBranch(path, name);
      await get().loadGitStatus(path);
    } catch (err: any) {
      console.error('Failed to publish branch:', err);
      throw err;
    }
  },

  gitMergeBranch: async (name, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitMergeBranch(path, name);
      await get().loadGitStatus(path);
      await get().gitLoadBranches(path);
    } catch (err: any) {
      console.error('Failed to merge branch:', err);
      // Re-load status regardless — a conflicted merge still needs the
      // existing conflicted-file detection in GitPanel to pick up state.
      await get().loadGitStatus(path);
      throw err;
    }
  },

  gitStashPush: async (message, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitStashPush(path, message);
      await get().loadGitStatus(path);
      await get().gitLoadStashes(path);
    } catch (err: any) {
      console.error('Failed to stash changes:', err);
      throw err;
    }
  },

  gitStashPop: async (index, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitStashPop(path, index);
      await get().loadGitStatus(path);
      await get().gitLoadStashes(path);
    } catch (err: any) {
      console.error('Failed to pop stash:', err);
      throw err;
    }
  },

  gitStashDrop: async (index, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      await api.gitStashDrop(path, index);
      await get().gitLoadStashes(path);
    } catch (err: any) {
      console.error('Failed to drop stash:', err);
      throw err;
    }
  },

  gitLoadStashes: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      const stashes = await api.gitStashList(path);
      set({ gitStashes: stashes });
    } catch (err) {
      console.error('Failed to load stashes:', err);
    }
  },

  gitGetStagedDiff: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return '';
    try {
      return await api.gitGetStagedDiff(path);
    } catch (err) {
      console.error('Failed to get staged diff:', err);
      return '';
    }
  },

  gitGetHeatmap: async (weeks = 52, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return {};
    try {
      return await api.gitGetHeatmap(path, weeks);
    } catch (err) {
      console.error('Failed to get commit heatmap:', err);
      return {};
    }
  },

  gitLoadRepoStats: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      const stats = await api.gitGetRepoStats(path);
      set({ repoStats: stats });
    } catch (err) {
      console.error('Failed to load repo stats:', err);
    }
  },

  gitLoadCommitFiles: async (hash, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      const files = await api.gitGetCommitFiles(path, hash);
      set({ commitFiles: files });
    } catch (err) {
      console.error('Failed to load commit files:', err);
    }
  },

  gitLoadFileHotspots: async (dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      const hotspots = await api.gitGetFileHotspots(path);
      set({ fileHotspots: hotspots });
    } catch (err) {
      console.error('Failed to load file hotspots:', err);
    }
  },

  gitGetCommitPatch: async (hash, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return '';
    try {
      return await api.gitGetCommitPatch(path, hash);
    } catch (err) {
      console.error('Failed to get commit patch:', err);
      return '';
    }
  },

  gitLoadBranchComparison: async (branchA, branchB, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;
    try {
      const files = await api.gitGetBranchDiff(path, branchA, branchB);
      set({ branchComparison: files });
    } catch (err) {
      console.error('Failed to load branch comparison:', err);
    }
  },

  gitOpenBranchFileDiff: async (branchA, branchB, relativePath, name, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    // Branch names can't contain ':', so this format is unambiguous to parse back apart (see EditorArea.tsx's DiffEditorPanel extraction).
    const diffPath = `branchdiff:${branchA}...${branchB}:${relativePath}`;
    if (useWorkspaceStore.getState().openTabs.some((t) => t.path === diffPath)) {
      useWorkspaceStore.getState().setActiveTab(diffPath);
      return;
    }

    try {
      const diffData = await api.gitGetBranchFileDiff(path, branchA, branchB, relativePath);
      const newTab: EditorTab = {
        name: `Diff: ${name} (${branchA}...${branchB})`,
        path: diffPath,
        content: diffData.modified,
        originalContent: diffData.original,
        isDirty: false,
        isDiff: true,
      };

      useWorkspaceStore.getState().openSyntheticTab(newTab);
    } catch (err) {
      console.error('Failed to open branch file diff:', err);
    }
  },

  gitLoadGitGraph: async (reset = false, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    const existing = reset ? [] : (get().gitGraphCommits ?? []);
    const skip = existing.length;

    try {
      const page = await api.gitGetCommitGraph(path, GIT_GRAPH_PAGE_SIZE, skip);
      set({
        gitGraphCommits: [...existing, ...page],
        gitGraphHasMore: page.length === GIT_GRAPH_PAGE_SIZE,
      });
    } catch (err) {
      console.error('Failed to load git graph:', err);
    }
  },

  gitDiscoverRepos: async (rootDir) => {
    const api = window.api;
    if (!api) return [];
    try {
      return await api.gitDiscoverRepos(rootDir);
    } catch (err) {
      console.error('Failed to discover nested repos:', err);
      return [];
    }
  },

  gitFetchCommitGraph: async (dir, limit, skip) => {
    const api = window.api;
    if (!api) return [];
    try {
      return await api.gitGetCommitGraph(dir, limit, skip);
    } catch (err) {
      console.error('Failed to fetch commit graph:', err);
      return [];
    }
  },

  gitFetchCommitFiles: async (dir, hash) => {
    const api = window.api;
    if (!api) return [];
    try {
      return await api.gitGetCommitFiles(dir, hash);
    } catch (err) {
      console.error('Failed to fetch commit files:', err);
      return [];
    }
  },

  gitFetchFileCommitHistory: async (dir, relativePath, limit) => {
    const api = window.api;
    if (!api) return [];
    try {
      return await api.gitGetFileCommitHistory(dir, relativePath, limit);
    } catch (err) {
      console.error('Failed to fetch file commit history:', err);
      return [];
    }
  },

  gitFetchCommitFileDiff: async (dir, hash, relativePath) => {
    const api = window.api;
    if (!api) return { original: '', modified: '' };
    try {
      return await api.gitGetCommitDiff(dir, hash, relativePath);
    } catch (err) {
      console.error('Failed to fetch commit file diff:', err);
      return { original: '', modified: '' };
    }
  },

  gitOpenCommitFileDiff: async (hash, relativePath, name, dir) => {
    const api = window.api;
    const path = dir ?? useWorkspaceStore.getState().workspacePath;
    if (!api || !path) return;

    // Deliberately a distinct prefix from `gitdiff:`, not a parameterized variant — else DiffEditorPanel's `gitdiff:` strip would corrupt the extraction.
    const diffPath = `gitcommitdiff:${hash}:${relativePath}`;
    if (useWorkspaceStore.getState().openTabs.some((t) => t.path === diffPath)) {
      useWorkspaceStore.getState().setActiveTab(diffPath);
      return;
    }

    try {
      const diffData = await api.gitGetCommitDiff(path, hash, relativePath);
      const newTab: EditorTab = {
        name: `Diff: ${name} @ ${hash.slice(0, 7)}`,
        path: diffPath,
        content: diffData.modified,
        originalContent: diffData.original,
        isDirty: false,
        isDiff: true,
      };

      useWorkspaceStore.getState().openSyntheticTab(newTab);
    } catch (err) {
      console.error('Failed to open commit file diff:', err);
    }
  },

  resetGitStatus: () => set({ gitRepoStatus: null }),
}));
