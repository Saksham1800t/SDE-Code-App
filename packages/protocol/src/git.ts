/** Canonical shapes for the git IPC boundary — this package owns them, gitService.ts imports rather than duplicates them. */

export interface GitFileEntry {
  path: string;
  relativePath: string;
  name: string;
  isStaged: boolean;
  isUnstaged: boolean;
  isConflict: boolean;
  statusText: string;
  statusCode: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  files: GitFileEntry[];
  ahead: number;
  behind: number;
}

export interface GitBranchesResult {
  current: string;
  local: string[];
  remote: string[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
}

export interface GitRemoteEntry {
  name: string;
  refs: { fetch: string; push: string };
}

export interface GitStashEntry {
  index: number;
  message: string;
  date: string;
}

export interface GitMergeStatus {
  isMerging: boolean;
  isRebasing: boolean;
  isCherryPicking: boolean;
}

export interface GitDiffResult {
  original: string;
  modified: string;
}

export interface GitRepoStats {
  commitCount: number;
  branchCount: number;
  contributorCount: number;
  tagCount: number;
  /** Semver-highest tag name (simple-git's own `tags().latest`), not necessarily the most recently created tag. */
  latestTag: string | null;
  latestCommit: GitLogEntry | null;
}

export interface GitCommitFileEntry {
  path: string;
  insertions: number;
  deletions: number;
  statusText: 'Added' | 'Modified' | 'Deleted' | 'Renamed';
  /** Only set for Renamed entries — the file's path before this commit. */
  fromPath?: string;
}

export interface GitFileHotspot {
  path: string;
  changeCount: number;
}

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
  /** 0 for a root commit, 1 for a normal commit, 2+ for a merge commit. */
  parents: string[];
}

export interface GitRepoRoot {
  /** Absolute path to the directory containing this repo's .git. */
  path: string;
  /** Basename of `path`, for section headers when more than one repo is found. */
  name: string;
}

/** The wire contract for every `git:*` channel, checked on both handler and invoker so mismatches are compile errors, not silent no-ops. */
export type GitIpcContract = {
  'git:status': (dir: string) => Promise<GitStatusResult>;
  'git:init': (dir: string) => Promise<boolean>;
  'git:stage': (dir: string, path: string) => Promise<void>;
  'git:unstage': (dir: string, path: string) => Promise<void>;
  'git:stageAll': (dir: string) => Promise<void>;
  'git:unstageAll': (dir: string) => Promise<void>;
  'git:discardFile': (dir: string, path: string) => Promise<void>;
  'git:discardAll': (dir: string) => Promise<void>;
  'git:commit': (dir: string, message: string) => Promise<void>;
  'git:undoLastCommit': (dir: string) => Promise<void>;
  'git:amendLastCommit': (dir: string, message: string) => Promise<void>;
  'git:push': (dir: string) => Promise<void>;
  'git:pull': (dir: string) => Promise<void>;
  'git:fetch': (dir: string) => Promise<void>;
  'git:diff': (dir: string, path: string) => Promise<GitDiffResult>;
  'git:getBranches': (dir: string) => Promise<GitBranchesResult>;
  'git:createBranch': (dir: string, name: string, from?: string) => Promise<void>;
  'git:checkoutBranch': (dir: string, name: string) => Promise<void>;
  'git:deleteBranch': (dir: string, name: string, force?: boolean) => Promise<void>;
  'git:renameBranch': (dir: string, oldName: string, newName: string) => Promise<void>;
  'git:publishBranch': (dir: string, name: string) => Promise<void>;
  'git:mergeBranch': (dir: string, name: string) => Promise<void>;
  'git:getLog': (dir: string, limit?: number) => Promise<GitLogEntry[]>;
  'git:getRemotes': (dir: string) => Promise<GitRemoteEntry[]>;
  'git:stashPush': (dir: string, message?: string) => Promise<void>;
  'git:stashPop': (dir: string, index?: number) => Promise<void>;
  'git:stashDrop': (dir: string, index: number) => Promise<void>;
  'git:stashList': (dir: string) => Promise<GitStashEntry[]>;
  'git:getMergeStatus': (dir: string) => Promise<GitMergeStatus>;
  'git:getStagedDiff': (dir: string) => Promise<string>;
  /** Full uncommitted diff (staged + unstaged, `git diff HEAD`) as one patch-formatted string — the payload Edit Sessions syncs. Untracked (never-`git add`ed) files are not included, same documented limitation `git stash` itself has by default. Empty string for a clean tree or a brand-new repo with no commits yet (unborn HEAD). */
  'git:getWorkingTreeDiff': (dir: string) => Promise<string>;
  /** Applies a patch produced by getWorkingTreeDiff via `git apply` — returns false (not a throw) if it doesn't apply cleanly, e.g. the local tree has since diverged. */
  'git:applyWorkingTreeDiff': (dir: string, diffText: string) => Promise<boolean>;
  'git:getHeatmap': (dir: string, weeks?: number) => Promise<Record<string, number>>;
  'git:getRepoStats': (dir: string) => Promise<GitRepoStats>;
  'git:getCommitFiles': (dir: string, hash: string) => Promise<GitCommitFileEntry[]>;
  'git:getCommitDiff': (dir: string, hash: string, relativePath: string) => Promise<GitDiffResult>;
  'git:getFileHotspots': (dir: string, commitLimit?: number, fileLimit?: number) => Promise<GitFileHotspot[]>;
  'git:getCommitPatch': (dir: string, hash: string) => Promise<string>;
  'git:getBranchDiff': (dir: string, branchA: string, branchB: string) => Promise<GitCommitFileEntry[]>;
  'git:getBranchFileDiff': (dir: string, branchA: string, branchB: string, relativePath: string) => Promise<GitDiffResult>;
  'git:getCommitGraph': (dir: string, limit?: number, skip?: number) => Promise<GitGraphCommit[]>;
  'git:discoverRepos': (rootDir: string) => Promise<GitRepoRoot[]>;
  'git:getFileCommitHistory': (dir: string, relativePath: string, limit?: number) => Promise<GitLogEntry[]>;
  'git:createWorktree': (dir: string, branchName: string) => Promise<string>;
  'git:removeWorktree': (dir: string, worktreePath: string) => Promise<void>;
};
