import type * as SdeSdk from '@sde-code/sdk';
import type { WalkthroughContribution, ResolvedWalkthroughContribution } from './walkthroughs';

/** Extension manifest shape for extension-host v1; `main`/`activationEvents` are optional so old manifests predating them still parse. */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  publisher: string;
  /** Existing free-form capability tags (e.g. "theme"). Predates activation events; left alone. */
  provides?: string[];
  dependsOn?: string[];
  /** Entry point relative to the extension's root directory; defaults to "dist/index.js" if omitted. */
  main?: string;
  /** When the extension activates: `"*"`/`"onStartupFinished"` at startup, `"onCommand:<id>"` on that command; omitted means never. */
  activationEvents?: string[];
  /** Declarative static contributions read via getStaticContributions(), distinct from imperative sdk registerX() runtime calls. */
  contributes?: ExtensionContributes;
}

export interface SnippetsContribution {
  language: string;
  /** Relative to this extension's own root directory. */
  path: string;
}

/**
 * An extension's declaration of "here's how to run a language server for
 * this language" — the extension-authorable equivalent of the built-in
 * `LANGUAGE_SERVERS` table in platform/lsp/lspService.ts. Purely data: the
 * host still owns spawning/framing/lifecycle, the extension just points at
 * a binary. `binary` is looked up on PATH the same way the built-in Python
 * entry is; an extension bundling its own server should resolve an
 * absolute path itself (e.g. via `__dirname`) rather than relying on PATH.
 */
export interface LanguageServerContribution {
  languageId: string;
  extensions: string[];
  binary: string;
  args?: string[];
}

/**
 * An extension's declaration of "here's how to run a debug adapter for
 * this language" — the extension-authorable equivalent of the built-in
 * `DEBUG_ADAPTERS` table in platform/dap/dapService.ts. Same shape and same
 * reasoning as LanguageServerContribution: purely data, the host still owns
 * spawning/framing/lifecycle.
 */
export interface DebugAdapterContribution {
  languageId: string;
  binary: string;
  args?: string[];
}

/**
 * An extension's declaration of a language Monaco doesn't already know at
 * all — the missing piece language-server/debug-adapter contributions
 * don't cover, since those only attach *behavior* to a language id Monaco
 * (or an already-open LSP connection) already recognizes. This is the
 * "teach the editor a new language exists" step: id + file extensions,
 * optionally a Monarch tokenizer (Monaco's own declarative syntax-highlighting
 * format — chosen over Tree-sitter/TextMate because Monaco has native
 * support for it with no extra parser/WASM bundling) and basic language
 * configuration (comments/brackets/auto-closing pairs). `monarch`/`configuration`
 * are typed loosely here (not against monaco-editor's real types) because
 * this package can't depend on monaco-editor — the renderer casts them at
 * the point of use, same as any other untyped-at-the-boundary JSON contribution.
 */
export interface LanguageDefinitionContribution {
  languageId: string;
  extensions: string[];
  aliases?: string[];
  monarch?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
}

export interface ExtensionContributes {
  snippets?: SnippetsContribution[];
  walkthroughs?: WalkthroughContribution[];
  languageServers?: LanguageServerContribution[];
  debugAdapters?: DebugAdapterContribution[];
  languages?: LanguageDefinitionContribution[];
}

// What the workbench sees once extensions register contributions — reuses @sde-code/sdk's own types unchanged, not mirrored copies.

export interface ExtensionCommandInfo {
  id: string;
  extensionId: string;
}

export interface ExtensionStatusBarItemInfo {
  id: string;
  extensionId: string;
  options: SdeSdk.StatusBarItemOptions;
}

export interface ExtensionThemeInfo {
  id: string;
  extensionId: string;
  variables: SdeSdk.ThemeVariables;
}

export interface ResolvedLanguageServerContribution extends LanguageServerContribution {
  extensionId: string;
}

export interface ResolvedDebugAdapterContribution extends DebugAdapterContribution {
  extensionId: string;
}

export interface ResolvedLanguageDefinitionContribution extends LanguageDefinitionContribution {
  extensionId: string;
}

export type ExtensionContributionsIpcContract = {
  'extensions:getCommands': () => Promise<ExtensionCommandInfo[]>;
  'extensions:executeCommand': (id: string, args: unknown[]) => Promise<unknown>;
  'extensions:getStatusBarItems': () => Promise<ExtensionStatusBarItemInfo[]>;
  'extensions:getThemes': () => Promise<ExtensionThemeInfo[]>;
  'extensions:getWalkthroughs': () => Promise<ResolvedWalkthroughContribution[]>;
  'extensions:getLanguageServers': () => Promise<ResolvedLanguageServerContribution[]>;
  'extensions:getDebugAdapters': () => Promise<ResolvedDebugAdapterContribution[]>;
  'extensions:getLanguageDefinitions': () => Promise<ResolvedLanguageDefinitionContribution[]>;
};
