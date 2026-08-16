import { DapConnection } from './dapConnection';
import { useDebugStore, type DapStackFrame } from '../store/debug';
import { languageForFile as lspLanguageForFile } from '../lsp/languageRegistry';

// Debugging piggybacks on the LSP language registry for "what language is this file" (no separate file-extension mapping needed — see DebugAdapterContribution's own doc comment) and keeps its own, smaller list of "which of those languages actually have a debug adapter." Python is the only built-in; extensions add more via contributes.debugAdapters, merged in by loadExtensionDebugLanguages().
const BUILTIN_DEBUG_LANGUAGES = new Set(['python']);
let extensionDebugLanguages = new Set<string>();
let loaded = false;

/** Fetches extension-declared debug-adapter languages from main — call once at startup. Safe to call more than once; only the first call does any work. */
export async function loadExtensionDebugLanguages(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const contributions = await window.api.getExtensionDebugAdapters?.().catch(() => []) ?? [];
  extensionDebugLanguages = new Set(contributions.map((c) => c.languageId));
}

function languageForFile(filePath: string): string | null {
  return lspLanguageForFile(filePath)?.languageId ?? null;
}

export function isDebuggableFile(filePath: string): boolean {
  const language = languageForFile(filePath);
  if (!language) return false;
  return BUILTIN_DEBUG_LANGUAGES.has(language) || extensionDebugLanguages.has(language);
}

/**
 * Drives one full DAP session lifecycle: spawn the adapter, do the
 * initialize/launch/setBreakpoints/configurationDone handshake in the
 * spec-mandated order (see the inline comments — this ordering is not
 * arbitrary), then keep the store's call stack/variables/console in sync
 * with `stopped`/`output`/`terminated` events for as long as the session runs.
 */
export async function startDebugSession(filePath: string, cwd: string): Promise<void> {
  const language = languageForFile(filePath);
  if (!language) return;

  const sessionId = crypto.randomUUID();
  const started = await window.api.dapStartSession(sessionId, language, filePath, cwd).catch(() => false);
  if (!started) return;

  const connection = new DapConnection(sessionId);
  useDebugStore.getState().registerSession(sessionId, filePath, connection);
  connection.listen();

  connection.onEvent('output', (body: { category?: string; output?: string }) => {
    useDebugStore.getState().appendConsole(sessionId, body.category ?? 'console', body.output ?? '');
  });

  connection.onEvent('stopped', async (body: { threadId?: number }) => {
    useDebugStore.getState().setSessionStatus(sessionId, 'paused');
    if (body.threadId === undefined) return;
    await refreshCallStackAndVariables(sessionId, connection, body.threadId);
  });

  connection.onEvent('continued', () => {
    useDebugStore.getState().setSessionStatus(sessionId, 'running');
    useDebugStore.getState().setCallStack(sessionId, []);
    useDebugStore.getState().setVariables(sessionId, []);
  });

  const finish = () => useDebugStore.getState().setSessionStatus(sessionId, 'terminated');
  connection.onEvent('terminated', finish);
  connection.onEvent('exited', finish);

  try {
    // Spec order: initialize -> (launch can fire right after, doesn't need to wait) -> wait for the adapter's own 'initialized' event -> setBreakpoints -> configurationDone -> launch resolves once the program actually starts.
    const initializedPromise = new Promise<void>((resolve) => {
      const off = connection.onEvent('initialized', () => { off(); resolve(); });
    });

    await connection.sendRequest('initialize', {
      clientID: 'sde-code',
      adapterID: language,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
    });

    const launchPromise = connection.sendRequest('launch', {
      request: 'launch',
      type: language,
      program: filePath,
      console: 'internalConsole',
      cwd,
      stopOnEntry: false,
    });

    await initializedPromise;

    const breakpointLines = useDebugStore.getState().getBreakpoints(filePath);
    await connection.sendRequest('setBreakpoints', {
      source: { path: filePath },
      breakpoints: breakpointLines.map((line) => ({ line })),
    });

    await connection.sendRequest('configurationDone', {});
    await launchPromise;

    useDebugStore.getState().setSessionStatus(sessionId, 'running');
  } catch (err: any) {
    useDebugStore.getState().setSessionStatus(sessionId, 'error', err?.message ?? 'Failed to start debug session.');
  }
}

async function refreshCallStackAndVariables(sessionId: string, connection: DapConnection, threadId: number): Promise<void> {
  const stackResult = await connection.sendRequest<{ stackFrames?: DapStackFrame[] }>('stackTrace', { threadId }).catch(() => null);
  const frames = stackResult?.stackFrames ?? [];
  useDebugStore.getState().setCallStack(sessionId, frames);

  const topFrame = frames[0];
  if (!topFrame) {
    useDebugStore.getState().setVariables(sessionId, []);
    return;
  }

  const scopesResult = await connection.sendRequest<{ scopes?: { name: string; variablesReference: number; expensive?: boolean }[] }>(
    'scopes', { frameId: topFrame.id },
  ).catch(() => null);

  const scopes = [];
  for (const scope of scopesResult?.scopes ?? []) {
    if (scope.expensive) continue; // e.g. "Globals" — large and slow, skip for the MVP's always-fetch-on-stop approach.
    const varsResult = await connection.sendRequest<{ variables?: any[] }>('variables', { variablesReference: scope.variablesReference }).catch(() => null);
    scopes.push({ scopeName: scope.name, variables: varsResult?.variables ?? [] });
  }
  useDebugStore.getState().setVariables(sessionId, scopes);
}

// debugpy is single-threaded for a plain script launch, so thread 1 is always right for the MVP — a real multi-thread-aware client would track threadId from the `stopped` event's own body per session instead of hardcoding it.
const MVP_THREAD_ID = 1;

export async function continueSession(sessionId: string): Promise<void> {
  const session = useDebugStore.getState().sessions[sessionId];
  if (!session) return;
  await session.connection.sendRequest('continue', { threadId: MVP_THREAD_ID }).catch(() => {});
}

export async function stepOver(sessionId: string): Promise<void> {
  const session = useDebugStore.getState().sessions[sessionId];
  if (!session) return;
  await session.connection.sendRequest('next', { threadId: MVP_THREAD_ID }).catch(() => {});
}

export async function stepIn(sessionId: string): Promise<void> {
  const session = useDebugStore.getState().sessions[sessionId];
  if (!session) return;
  await session.connection.sendRequest('stepIn', { threadId: MVP_THREAD_ID }).catch(() => {});
}

export async function stepOut(sessionId: string): Promise<void> {
  const session = useDebugStore.getState().sessions[sessionId];
  if (!session) return;
  await session.connection.sendRequest('stepOut', { threadId: MVP_THREAD_ID }).catch(() => {});
}

export async function stopSession(sessionId: string): Promise<void> {
  const session = useDebugStore.getState().sessions[sessionId];
  if (session) {
    await session.connection.sendRequest('disconnect', { terminateDebuggee: true }, 3000).catch(() => {});
    session.connection.dispose();
  }
  await window.api.dapStopSession(sessionId).catch(() => {});
  useDebugStore.getState().removeSession(sessionId);
}
