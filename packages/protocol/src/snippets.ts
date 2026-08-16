export interface SnippetDefinition {
  name: string;
  prefix: string | string[];
  body: string | string[];
  description?: string;
  source: 'user' | 'extension';
  extensionId?: string;
}

/** Lives here (not extension-host/) so platform/snippets can depend on this shape without a relative import crossing the layer boundary. */
export interface ResolvedSnippetContribution {
  extensionId: string;
  language: string;
  absolutePath: string;
}

export type SnippetsIpcContract = {
  'snippets:getForLanguage': (languageId: string) => Promise<SnippetDefinition[]>;
  /** Creates `<language>.json` under the user snippets dir if missing (with starter content), returns its absolute path either way. */
  'snippets:ensureUserSnippetFile': (languageId: string) => Promise<string>;
  /** Language ids (filenames without `.json`) that already have a personal snippet file, for Settings' "Configure Snippets" list. */
  'snippets:listUserSnippetFiles': () => Promise<string[]>;
  /** Raw file content (verbatim, comments and all) for cloud sync push. */
  'snippets:getUserSnippetFileContent': (languageId: string) => Promise<string>;
  /** Overwrites `<language>.json` with raw content, unlike ensureUserSnippetFile — used to restore from cloud sync pull. */
  'snippets:writeUserSnippetFileContent': (languageId: string, content: string) => Promise<void>;
};
