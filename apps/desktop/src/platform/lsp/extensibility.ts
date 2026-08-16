import type { ResolvedLanguageServerContribution } from '@sde-code/protocol';

/** Lets LspService pull in extension-contributed language servers without importing extension-host directly (platform/ can't depend on extension-host/); wired in via a setter, not constructor injection, same pattern as platform/ai/extensibility.ts. */
export interface IExtensionLanguageServerProvider {
  listLanguageServers(): ResolvedLanguageServerContribution[];
}
