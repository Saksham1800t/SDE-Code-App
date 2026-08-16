/** @sde-code/sdk — exports real versioned TYPES only; the runtime bodies are intercepted by the extension-host sandbox at load time (like VS Code's `vscode` module), and throw a clear error if called outside it. */

export interface StatusBarItemOptions {
  text: string;
  icon?: string;
  tooltip?: string;
  priority?: number;
  alignment?: 'left' | 'right';
  commandId?: string;
}

export interface ThemeVariables {
  bgPrimary: string;
  bgSecondary: string;
  textPrimary: string;
  accentCyan: string;
  /** Optional file-icon overrides: a lowercase file extension (no dot, e.g. "ts") or an exact lowercase filename (e.g. "package.json") mapped to an icon URL. Any file not covered falls back to SDE Code's built-in icon set. */
  iconMap?: Record<string, string>;
  [key: string]: string | Record<string, string> | undefined;
}

// AI extension surface, reserved ahead of extension-host v1 wiring it up — registerAIProvider/AITool/ContextProvider aren't consumed by the host yet.

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIStreamChunk {
  text: string;
}

export interface AIProviderRequest {
  model: string;
  messages: AIMessage[];
  /** Provider-specific options (temperature, max tokens, etc.), passed through untouched. */
  options?: Record<string, unknown>;
}

/** Contributed by an extension to add a new AI backend to SDE Code's model picker. */
export interface AIProvider {
  id: string;
  displayName: string;
  models: string[];
  /** Streams a response via `onChunk`; the returned promise resolves on completion. Mirrors AiQuerySink's shape intentionally. */
  streamCompletion(request: AIProviderRequest, onChunk: (chunk: AIStreamChunk) => void, signal: AbortSignal): Promise<void>;
}

/** A capability an AI agent can invoke mid-conversation. Distinct from AIProvider: a provider is talked *to*, a tool is called *through* it. */
export interface AITool {
  name: string;
  description: string;
  /** JSON Schema describing the tool's parameters — the shape every major provider's function-calling API expects. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

/** Supplies extra context folded into AI prompts — the extension equivalent of AiService.query()'s hand-rolled project_rules/memory read. */
export interface ContextProvider {
  id: string;
  /** Called before each AI query; returning null contributes nothing that time. */
  provideContext(request: { activeFilePath?: string; prompt: string }): Promise<string | null>;
}

// ---------------------------------------------------------------------------

interface SdeExtensionBridge {
  registerCommand(id: string, callback: (...args: unknown[]) => unknown): void;
  registerStatusBarItem(id: string, options: StatusBarItemOptions): void;
  registerTheme(id: string, variables: ThemeVariables): void;
  registerAIProvider(provider: AIProvider): void;
  registerAITool(tool: AITool): void;
  registerContextProvider(provider: ContextProvider): void;
}

function getBridge(functionName: string): SdeExtensionBridge {
  const bridge = (globalThis as { __sdeExtensionBridge?: SdeExtensionBridge }).__sdeExtensionBridge;
  if (!bridge) {
    throw new Error(
      `@sde-code/sdk's ${functionName}() has no effect outside a running SDE Code extension — ` +
        'this module only works when loaded inside the extension host sandbox.',
    );
  }
  return bridge;
}

/** Registers a custom command callback in SDE Code. */
export function registerCommand(id: string, callback: (...args: unknown[]) => unknown): void {
  getBridge('registerCommand').registerCommand(id, callback);
}

/** Contributes a custom indicator element to SDE Code's status bar. */
export function registerStatusBarItem(id: string, options: StatusBarItemOptions): void {
  getBridge('registerStatusBarItem').registerStatusBarItem(id, options);
}

/** Contributes a custom layout color theme. */
export function registerTheme(id: string, variables: ThemeVariables): void {
  getBridge('registerTheme').registerTheme(id, variables);
}

/** Registers a new AI provider. Not yet consumed by the host — see the module doc comment above. */
export function registerAIProvider(provider: AIProvider): void {
  getBridge('registerAIProvider').registerAIProvider(provider);
}

/** Registers a new AI tool. Not yet consumed by the host — see the module doc comment above. */
export function registerAITool(tool: AITool): void {
  getBridge('registerAITool').registerAITool(tool);
}

/** Registers a new AI context provider. Not yet consumed by the host — see the module doc comment above. */
export function registerContextProvider(provider: ContextProvider): void {
  getBridge('registerContextProvider').registerContextProvider(provider);
}
