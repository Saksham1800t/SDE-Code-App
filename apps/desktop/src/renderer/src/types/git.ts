export interface GitFile {
  path: string;
  relativePath: string;
  name: string;
  isStaged: boolean;
  isUnstaged: boolean;
  isConflict?: boolean;
  statusText: string;
  statusCode: string;
}

export interface GitRepoStatus {
  isRepo: boolean;
  branch: string;
  files: GitFile[];
  ahead?: number;
  behind?: number;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
}

export interface GitStash {
  index: number;
  message: string;
  date: string;
}

export interface GitBranches {
  current: string;
  local: string[];
  remote: string[];
}

export interface GitRepoStats {
  commitCount: number;
  branchCount: number;
  contributorCount: number;
  tagCount: number;
  latestTag: string | null;
  latestCommit: GitCommit | null;
}

export interface GitCommitFile {
  path: string;
  insertions: number;
  deletions: number;
  statusText: 'Added' | 'Modified' | 'Deleted' | 'Renamed';
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
  parents: string[];
}

export interface GitRepoRoot {
  path: string;
  name: string;
}
