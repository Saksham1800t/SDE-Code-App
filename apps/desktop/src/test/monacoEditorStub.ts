/**
 * Stands in for the real `monaco-editor` package under Vitest.
 *
 * monaco-editor ships browser-only ESM (no CJS entry, no `exports` map —
 * just `"module"` in its package.json) and touches DOM globals (`navigator`,
 * `document`) at import time — it needs a bundler's browser resolution and a
 * real DOM to load at all, neither of which vitest.config.ts's plain `node`
 * environment provides (deliberately: platform/kernel code has no DOM
 * dependency, see that file's doc comment). Several renderer store tests
 * transitively import it anyway via store/workspace.ts -> lsp/, without
 * actually exercising any Monaco behavior — this stub is aliased in over the
 * real package so those imports resolve instead of crashing the whole file.
 *
 * Only implements what src/renderer/src/lsp/*.ts touches at runtime (see
 * that directory for the full call sites); type-only references (Position,
 * IRange, ITextModel, IMarkerData) need no runtime shape at all.
 */

function makeUri(raw: string) {
  return {
    toString: (_skipEncoding?: boolean) => raw,
    fsPath: raw,
    path: raw,
    scheme: 'file',
    authority: '',
  };
}

export const Uri = {
  file: (path: string) => makeUri(path),
  parse: (value: string) => makeUri(value),
};

export const MarkerSeverity = { Error: 8, Warning: 4, Info: 2, Hint: 1 };

export const languages = {
  CompletionItemKind: {
    Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6,
    Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19,
    Constant: 20, Struct: 21, Event: 22, Operator: 23, TypeParameter: 24,
  },
  registerCompletionItemProvider: () => ({ dispose() {} }),
  registerHoverProvider: () => ({ dispose() {} }),
  registerDefinitionProvider: () => ({ dispose() {} }),
};

export const editor = {
  getModels: () => [],
  getModel: () => null,
  setModelMarkers: () => {},
};

export default { Uri, MarkerSeverity, languages, editor };
