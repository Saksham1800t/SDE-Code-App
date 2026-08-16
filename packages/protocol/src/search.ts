export interface SearchMatch {
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchFileResult {
  file: string;
  relativePath: string;
  matches: SearchMatch[];
}

export interface SearchInFilesOptions {
  caseSensitive: boolean;
  isRegex: boolean;
  wholeWord: boolean;
  includeGlob: string;
  excludeGlob: string;
}

export interface ReplaceInFilesResult {
  filesChanged: number;
  matchesReplaced: number;
}

export interface WorkspaceSymbolResult {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'variable' | 'method';
  line: number;
  relativePath: string;
  file: string;
}

export type SearchIpcContract = {
  'search:inFiles': (rootDir: string, query: string, options: SearchInFilesOptions) => Promise<SearchFileResult[]>;
  'search:listAllFiles': (rootDir: string) => Promise<string[]>;
  /** Omit targetFile to replace across every matched file; pass one to scope the replace to it. */
  'search:replaceInFiles': (
    rootDir: string,
    query: string,
    replaceText: string,
    options: SearchInFilesOptions,
    targetFile?: string,
  ) => Promise<ReplaceInFilesResult>;
  'search:workspaceSymbols': (rootDir: string) => Promise<WorkspaceSymbolResult[]>;
};
