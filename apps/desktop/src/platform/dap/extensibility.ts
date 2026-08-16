import type { ResolvedDebugAdapterContribution } from '@sde-code/protocol';

/** Lets DapService pull in extension-contributed debug adapters without importing extension-host directly (platform/ can't depend on extension-host/); wired in via a setter, not constructor injection, same pattern as platform/lsp/extensibility.ts. */
export interface IExtensionDebugAdapterProvider {
  listDebugAdapters(): ResolvedDebugAdapterContribution[];
}
