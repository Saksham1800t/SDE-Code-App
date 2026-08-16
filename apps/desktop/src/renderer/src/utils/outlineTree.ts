/** Shape of TypeScript's own `ts.NavigationTree`, as returned by Monaco's TS/JS worker (`getNavigationTree`) — deliberately loose/`any`-typed at the boundary like the rest of TypeScriptWorker's surface. */
export interface RawNavigationTree {
  text: string;
  kind: string;
  spans?: { start: number; length: number }[];
  childItems?: RawNavigationTree[];
}

export interface OutlineSymbol {
  name: string;
  /** TypeScript's ScriptElementKind string (e.g. 'function', 'class', 'method', 'property', 'interface', 'const', 'let', 'var', 'module'). */
  kind: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  children: OutlineSymbol[];
}

export type OffsetToPosition = (offset: number) => { lineNumber: number; column: number };

/** Converts a raw ts.NavigationTree into OutlineSymbol[], returning the synthetic root's childItems directly (matching VS Code's Outline). `offsetToPosition` is injected so this stays plain-data testable. */
export function convertNavigationTree(tree: RawNavigationTree, offsetToPosition: OffsetToPosition): OutlineSymbol[] {
  const convertNode = (node: RawNavigationTree): OutlineSymbol => {
    const span = node.spans?.[0];
    const start = span ? offsetToPosition(span.start) : { lineNumber: 1, column: 1 };
    const end = span ? offsetToPosition(span.start + span.length) : { lineNumber: 1, column: 1 };
    return {
      name: node.text,
      kind: node.kind,
      startLine: start.lineNumber,
      startColumn: start.column,
      endLine: end.lineNumber,
      endColumn: end.column,
      children: (node.childItems ?? []).map(convertNode),
    };
  };
  return (tree.childItems ?? []).map(convertNode);
}

function containsPosition(sym: OutlineSymbol, line: number, column: number): boolean {
  if (line < sym.startLine || line > sym.endLine) return false;
  if (line === sym.startLine && column < sym.startColumn) return false;
  if (line === sym.endLine && column > sym.endColumn) return false;
  return true;
}

/** Finds the innermost symbol whose range contains the cursor position — what the breadcrumb's "current symbol" segment shows. Null outside any symbol. */
export function findSymbolAtPosition(symbols: OutlineSymbol[], line: number, column: number): OutlineSymbol | null {
  for (const sym of symbols) {
    if (containsPosition(sym, line, column)) {
      return findSymbolAtPosition(sym.children, line, column) ?? sym;
    }
  }
  return null;
}

/** Depth-first flattening with nesting depth attached — feeds the Outline panel's indented rows and the breadcrumb dropdown's flat list. */
export function flattenSymbols(symbols: OutlineSymbol[], depth = 0): { symbol: OutlineSymbol; depth: number }[] {
  return symbols.flatMap((s) => [{ symbol: s, depth }, ...flattenSymbols(s.children, depth + 1)]);
}
