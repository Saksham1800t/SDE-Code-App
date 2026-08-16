import * as monaco from 'monaco-editor';
import {
  CompletionRequest,
  HoverRequest,
  DefinitionRequest,
  SemanticTokensRequest,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  PublishDiagnosticsNotification,
} from 'vscode-languageserver-protocol';
import type {
  CompletionItem as LspCompletionItem,
  Hover as LspHover,
  Location as LspLocation,
  Diagnostic as LspDiagnostic,
  Position as LspPosition,
  Range as LspRange,
} from 'vscode-languageserver-protocol';
import type { LspSemanticTokensLegend } from '@sde-code/protocol';
import { getLspConnection, toFileUri, modelFilePath, findModelForServerUri, getSemanticTokensLegend } from './lspClientManager';
import { useWorkspaceStore } from '../store/workspace';
import { findOwningFolder } from '../utils/codeMapImpact';

// Per-language document version counters and "diagnostics listener already registered" guards, both keyed by `${languageId}::${workspaceRoot}` so multiple language clients never collide.
const documentVersions = new Map<string, number>();
const diagnosticsWired = new Set<string>();
const registeredLanguages = new Set<string>();

// The fixed legend Monaco is told to expect (via getLegend()) — must match what platform/lsp/lspService.ts declares as the client's semanticTokens capability. A server's *actual* legend (fetched per-connection, possibly a different subset/order) gets translated into these indices in translateSemanticTokensData, so Monaco never needs to know it varies per server.
const CANONICAL_TOKEN_TYPES = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'];
const CANONICAL_TOKEN_MODIFIERS = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'];

// LSP's CompletionItemKind values are frozen by the spec (1=Text..25=TypeParameter) — safe to hardcode as map keys; Monaco's own enum is referenced by name since its numeric values differ.
const COMPLETION_KIND_MAP: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Unit,
  12: monaco.languages.CompletionItemKind.Value,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  16: monaco.languages.CompletionItemKind.Color,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  20: monaco.languages.CompletionItemKind.EnumMember,
  21: monaco.languages.CompletionItemKind.Constant,
  22: monaco.languages.CompletionItemKind.Struct,
  23: monaco.languages.CompletionItemKind.Event,
  24: monaco.languages.CompletionItemKind.Operator,
  25: monaco.languages.CompletionItemKind.TypeParameter,
};

// LSP DiagnosticSeverity (1=Error..4=Hint) vs Monaco's MarkerSeverity, which uses different numeric values.
const SEVERITY_MAP: Record<number, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
};

function toLspPosition(position: monaco.Position): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function fromLspRange(range: LspRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function resolveWorkspaceRoot(filePath: string): string | null {
  return findOwningFolder(filePath, useWorkspaceStore.getState().workspaceFolders)?.path ?? null;
}

/**
 * Re-encodes a server's `semanticTokens/full` `data` array (5-int tuples:
 * deltaLine, deltaStartChar, length, typeIndex, modifierBitset) so its type
 * and modifier indices point into CANONICAL_TOKEN_TYPES/MODIFIERS instead of
 * the server's own legend. Position fields (deltaLine/deltaStartChar/length)
 * pass through untouched — they're relative to the *previous emitted token*,
 * so a token can never be dropped here (only remapped) or every later
 * token's position would decode wrong. An unrecognized type name falls back
 * to index 0 rather than being dropped, for the same reason; an
 * unrecognized modifier bit is just left out of the rebuilt bitset, which is
 * safe since modifiers don't participate in position encoding.
 */
export function translateSemanticTokensData(raw: readonly number[], serverLegend: LspSemanticTokensLegend): Uint32Array {
  const typeTable = serverLegend.tokenTypes.map((name) => {
    const idx = CANONICAL_TOKEN_TYPES.indexOf(name);
    return idx === -1 ? 0 : idx;
  });
  const modifierTable = serverLegend.tokenModifiers.map((name) => CANONICAL_TOKEN_MODIFIERS.indexOf(name));

  const out = new Uint32Array(raw.length);
  for (let i = 0; i + 4 < raw.length; i += 5) {
    out[i] = raw[i];
    out[i + 1] = raw[i + 1];
    out[i + 2] = raw[i + 2];
    out[i + 3] = typeTable[raw[i + 3]] ?? 0;

    let modifiers = 0;
    const rawModifiers = raw[i + 4];
    for (let bit = 0; bit < serverLegend.tokenModifiers.length; bit++) {
      if ((rawModifiers & (1 << bit)) === 0) continue;
      const canonicalBit = modifierTable[bit];
      if (canonicalBit !== -1) modifiers |= (1 << canonicalBit);
    }
    out[i + 4] = modifiers;
  }
  return out;
}

/**
 * Registers pyright-shaped completion, hover, definition, and diagnostics
 * support for a single Monaco language id. Every language server this app
 * talks to (Python today, more later) goes through this exact same
 * function — the only thing that varies per language is `languageId`
 * itself, which both selects the Monaco providers to attach to and (via
 * `getLspConnection`) which server binary main process spawns for it. This
 * is the same shape as VS Code: one `vscode-languageclient` core, N
 * extensions that each just point it at a different server.
 */
export function registerLspLanguageClient(languageId: string): void {
  if (registeredLanguages.has(languageId)) return;
  registeredLanguages.add(languageId);

  monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const filePath = modelFilePath(model);
      const workspaceRoot = resolveWorkspaceRoot(filePath);
      if (!workspaceRoot) return { suggestions: [] };
      const connection = await getLspConnection(languageId, workspaceRoot);
      if (!connection) return { suggestions: [] };

      const result = await connection.sendRequest(CompletionRequest.type, {
        textDocument: { uri: toFileUri(filePath) },
        position: toLspPosition(position),
      }).catch(() => null);
      const items: LspCompletionItem[] = Array.isArray(result) ? result : result?.items ?? [];

      const word = model.getWordUntilPosition(position);
      const defaultRange = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };

      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind: COMPLETION_KIND_MAP[item.kind ?? 1] ?? monaco.languages.CompletionItemKind.Text,
          insertText: item.insertText ?? item.label,
          detail: item.detail,
          documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
          range: defaultRange,
        })),
      };
    },
  });

  monaco.languages.registerHoverProvider(languageId, {
    async provideHover(model, position) {
      const filePath = modelFilePath(model);
      const workspaceRoot = resolveWorkspaceRoot(filePath);
      if (!workspaceRoot) return null;
      const connection = await getLspConnection(languageId, workspaceRoot);
      if (!connection) return null;

      const hover: LspHover | null = await connection.sendRequest(HoverRequest.type, {
        textDocument: { uri: toFileUri(filePath) },
        position: toLspPosition(position),
      }).catch(() => null);
      if (!hover) return null;

      const contentsValue = typeof hover.contents === 'string'
        ? hover.contents
        : 'value' in (hover.contents as any)
          ? (hover.contents as any).value
          : Array.isArray(hover.contents)
            ? hover.contents.map((c: any) => (typeof c === 'string' ? c : c.value)).join('\n\n')
            : '';

      return {
        contents: [{ value: contentsValue }],
        range: hover.range ? fromLspRange(hover.range) : undefined,
      };
    },
  });

  monaco.languages.registerDefinitionProvider(languageId, {
    async provideDefinition(model, position) {
      const filePath = modelFilePath(model);
      const workspaceRoot = resolveWorkspaceRoot(filePath);
      if (!workspaceRoot) return null;
      const connection = await getLspConnection(languageId, workspaceRoot);
      if (!connection) return null;

      const result = await connection.sendRequest(DefinitionRequest.type, {
        textDocument: { uri: toFileUri(filePath) },
        position: toLspPosition(position),
      }).catch(() => null);
      if (!result) return null;

      const locations: LspLocation[] = Array.isArray(result) ? (result as LspLocation[]) : [result as LspLocation];
      return locations
        .filter((loc) => !!loc.uri)
        .map((loc) => ({
          uri: monaco.Uri.parse(loc.uri),
          range: fromLspRange(loc.range),
        }));
    },
  });

  monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
    getLegend: () => ({ tokenTypes: CANONICAL_TOKEN_TYPES, tokenModifiers: CANONICAL_TOKEN_MODIFIERS }),
    async provideDocumentSemanticTokens(model) {
      const filePath = modelFilePath(model);
      const workspaceRoot = resolveWorkspaceRoot(filePath);
      if (!workspaceRoot) return null;
      const connection = await getLspConnection(languageId, workspaceRoot);
      if (!connection) return null;
      // Fetched at connection time in lspClientManager.ts — null means this server never advertised semanticTokensProvider at all (not every language server implements it).
      const legend = getSemanticTokensLegend(languageId, workspaceRoot);
      if (!legend) return null;

      const result = await connection.sendRequest(SemanticTokensRequest.type, {
        textDocument: { uri: toFileUri(filePath) },
      }).catch(() => null);
      if (!result?.data) return null;

      return { data: translateSemanticTokensData(result.data, legend) };
    },
    releaseDocumentSemanticTokens() {},
  });
}

async function ensureDiagnosticsWired(languageId: string, workspaceRoot: string): Promise<void> {
  const key = `${languageId}::${workspaceRoot}`;
  if (diagnosticsWired.has(key)) return;
  const connection = await getLspConnection(languageId, workspaceRoot);
  if (!connection || diagnosticsWired.has(key)) return;
  diagnosticsWired.add(key);

  connection.onNotification(PublishDiagnosticsNotification.type, (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
    const model = findModelForServerUri(params.uri);
    if (!model) return;
    const markers: monaco.editor.IMarkerData[] = params.diagnostics.map((d) => ({
      ...fromLspRange(d.range),
      message: typeof d.message === 'string' ? d.message : d.message.value,
      severity: SEVERITY_MAP[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
      source: d.source ?? languageId,
    }));
    // Shares the marker owner name other providers key off of via
    // useProblemsStore.getState().recomputeFromMarkers(monaco) — no new
    // Problems-panel wiring needed, diagnostics show up there for free.
    monaco.editor.setModelMarkers(model, languageId, markers);
  });
}

export async function notifyDocumentOpened(languageId: string, filePath: string, content: string): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(filePath);
  if (!workspaceRoot) return;
  const connection = await getLspConnection(languageId, workspaceRoot);
  if (!connection) return;
  await ensureDiagnosticsWired(languageId, workspaceRoot);

  documentVersions.set(`${languageId}::${filePath}`, 1);
  connection.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri: toFileUri(filePath), languageId, version: 1, text: content },
  });
}

export function notifyDocumentChanged(languageId: string, filePath: string, content: string): void {
  const workspaceRoot = resolveWorkspaceRoot(filePath);
  if (!workspaceRoot) return;
  const versionKey = `${languageId}::${filePath}`;
  const version = (documentVersions.get(versionKey) ?? 1) + 1;
  documentVersions.set(versionKey, version);

  getLspConnection(languageId, workspaceRoot).then((connection) => {
    if (!connection) return;
    connection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: toFileUri(filePath), version },
      contentChanges: [{ text: content }],
    });
  });
}

export function notifyDocumentClosed(languageId: string, filePath: string): void {
  const workspaceRoot = resolveWorkspaceRoot(filePath);
  documentVersions.delete(`${languageId}::${filePath}`);
  if (!workspaceRoot) return;

  getLspConnection(languageId, workspaceRoot).then((connection) => {
    connection?.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: toFileUri(filePath) },
    });
  });
}
