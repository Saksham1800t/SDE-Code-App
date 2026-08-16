/**
 * The one place a new language server gets wired up on the renderer side —
 * mirrors how a VS Code language extension declares its `activationEvents`
 * file-extension globs. The main-process counterpart is `LANGUAGE_SERVERS`
 * in platform/lsp/lspService.ts (the actual server binary/args); this table
 * only needs to agree with it on the `languageId` string.
 *
 * Extension-contributed languages (via an extension's `contributes.languageServers`)
 * are merged in at startup by loadExtensionLanguages() — this file only owns
 * the built-in languages the app ships with regardless of installed extensions.
 */
export interface LspLanguageDescriptor {
  languageId: string;
  extensions: string[];
}

const BUILTIN_LANGUAGES: LspLanguageDescriptor[] = [
  { languageId: 'python', extensions: ['.py'] },
];

let extensionLanguages: LspLanguageDescriptor[] = [];
let loaded = false;

/** Fetches extension-declared languages from main and merges them in — call once at startup, before registerAllLspLanguageClients(). Safe to call more than once; only the first call does any work. */
export async function loadExtensionLanguages(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const contributions = await window.api.getExtensionLanguageServers?.().catch(() => []) ?? [];
  extensionLanguages = contributions.map((c) => ({ languageId: c.languageId, extensions: c.extensions }));
}

export function allLspLanguages(): LspLanguageDescriptor[] {
  // Built-ins first so an extension redeclaring 'python' can't shadow it in this list (LspService's own resolveServerConfig is the actual override point, not this list).
  return [...BUILTIN_LANGUAGES, ...extensionLanguages.filter((e) => !BUILTIN_LANGUAGES.some((b) => b.languageId === e.languageId))];
}

export function languageForFile(filePath: string): LspLanguageDescriptor | null {
  const lower = filePath.toLowerCase();
  return allLspLanguages().find((lang) => lang.extensions.some((ext) => lower.endsWith(ext))) ?? null;
}
