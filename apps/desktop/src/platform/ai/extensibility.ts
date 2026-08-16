import type { AITool } from '@sde-code/sdk';

/** Lets AiService pull in extension-contributed AI tools/context without importing extension-host directly (platform/ can't depend on extension-host/); wired in via setters, not constructor injection, so aiService.test.ts's `new AiService(...)` calls don't need to change. */
export interface IExtensionToolProvider {
  listTools(): AITool[];
}

export interface IExtensionContextProvider {
  /** Collects non-empty context strings from every registered provider; one provider's failure never blocks the others. */
  collectContext(request: { activeFilePath?: string; prompt: string }): Promise<string[]>;
}
