import * as monaco from 'monaco-editor';
import type { MessageConnection } from 'vscode-jsonrpc';
import type { LspSemanticTokensLegend } from '@sde-code/protocol';
import { createLspConnection } from './lspTransport';

const connections = new Map<string, MessageConnection>();
const unavailable = new Set<string>();
// Fetched once per connection, right after the handshake — a server's legend is inherent to that server binary/version, not to any particular file, so there's no reason to refetch per request.
const semanticTokensLegends = new Map<string, LspSemanticTokensLegend | null>();
// Dedupes concurrent getLspConnection() calls for the same key onto a single in-flight promise — e.g. workspace.ts's notifyDocumentOpened and a just-mounted editor's semantic-tokens provider both call this nearly simultaneously on file open. Without this, a second caller would create its own duplicate MessageConnection/IPC-listener pair, and — since main's own ensureServer() used to have the matching bug — could read back a not-yet-populated semanticTokensLegend.
const pendingConnections = new Map<string, Promise<MessageConnection | null>>();

function keyOf(language: string, workspaceRoot: string): string {
  return `${language}::${workspaceRoot}`;
}

/**
 * Starts (if needed) the server for this (language, workspace root) and
 * returns its connection. Returns null without retrying once a language has
 * been confirmed unavailable for this session — every failed PATH lookup
 * would otherwise get repeated on every file open.
 */
export async function getLspConnection(language: string, workspaceRoot: string): Promise<MessageConnection | null> {
  const key = keyOf(language, workspaceRoot);
  const existing = connections.get(key);
  if (existing) return existing;
  if (unavailable.has(language)) return null;

  const pending = pendingConnections.get(key);
  if (pending) return pending;

  const promise = createConnection(key, language, workspaceRoot).finally(() => pendingConnections.delete(key));
  pendingConnections.set(key, promise);
  return promise;
}

async function createConnection(key: string, language: string, workspaceRoot: string): Promise<MessageConnection | null> {
  const api = window.api;
  if (!api?.lspEnsureServer) return null;

  const started = await api.lspEnsureServer(language, workspaceRoot).catch(() => false);
  if (!started) {
    unavailable.add(language);
    return null;
  }

  const connection = createLspConnection(language, workspaceRoot);
  connections.set(key, connection);
  semanticTokensLegends.set(key, await api.lspGetSemanticTokensLegend(language, workspaceRoot).catch(() => null));
  return connection;
}

/** The connected server's own token-type/modifier legend, fetched once at connection time — null if that server never advertised semantic tokens support, or if the connection hasn't finished starting yet. */
export function getSemanticTokensLegend(language: string, workspaceRoot: string): LspSemanticTokensLegend | null {
  return semanticTokensLegends.get(keyOf(language, workspaceRoot)) ?? null;
}

/** Builds a spec-correct `file://` URI (percent-encoded, lowercase drive letter) matching what real LSP servers like pyright send/expect — via `monaco.Uri.file`, not string concatenation. */
export function toFileUri(filePath: string): string {
  return monaco.Uri.file(filePath).toString();
}

/**
 * `@monaco-editor/react` builds every model via `monaco.Uri.parse(rawPath)`,
 * not `Uri.file(rawPath)`. On Windows this misparses the drive letter as the
 * URI *scheme* (e.g. "C:/Users/..." -> scheme "C", path "/Users/...", losing
 * the drive letter from `.path`/`.fsPath`). `toString(true)` (skipEncoding)
 * is the only accessor that reconstructs the original raw path faithfully —
 * use this instead of `.path`/`.fsPath` anywhere a model's real file path is needed.
 */
export function modelFilePath(model: monaco.editor.ITextModel): string {
  return model.uri.toString(true);
}

function normalizeForCompare(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Finds the open model matching a server-sent `file://` URI, working around the model-URI misparse described in {@link modelFilePath} by comparing normalized paths instead of Uri objects/strings directly. */
export function findModelForServerUri(uri: string): monaco.editor.ITextModel | null {
  const target = normalizeForCompare(monaco.Uri.parse(uri).fsPath);
  for (const model of monaco.editor.getModels()) {
    if (normalizeForCompare(modelFilePath(model)) === target) return model;
  }
  return null;
}
