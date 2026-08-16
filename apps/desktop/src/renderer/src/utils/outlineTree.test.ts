import { describe, expect, it } from 'vitest';
import { convertNavigationTree, findSymbolAtPosition, flattenSymbols, type RawNavigationTree } from './outlineTree';

// Simple test double for offset->position: treats the "source" as lines of
// equal width isn't realistic, so tests instead hand-pick offsets against a
// small lookup table built per test, matching how model.getPositionAt real
// callers would behave for a specific known source string.
function makeOffsetToPosition(source: string) {
  const lines = source.split('\n');
  return (offset: number) => {
    let remaining = offset;
    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length + 1; // +1 for the '\n'
      if (remaining < lineLength) return { lineNumber: i + 1, column: remaining + 1 };
      remaining -= lineLength;
    }
    const last = lines.length - 1;
    return { lineNumber: lines.length, column: lines[last].length + 1 };
  };
}

describe('convertNavigationTree', () => {
  it('skips the synthetic root wrapper, returning its childItems as top-level symbols', () => {
    const source = 'function foo() {}\n';
    const tree: RawNavigationTree = {
      text: '<global>',
      kind: 'module',
      childItems: [{ text: 'foo', kind: 'function', spans: [{ start: 0, length: 18 }] }],
    };
    const result = convertNavigationTree(tree, makeOffsetToPosition(source));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('foo');
    expect(result[0].kind).toBe('function');
  });

  it('converts a span into 1-based start/end line and column', () => {
    const source = 'const x = 1;\nfunction bar() {}\n';
    // "function bar() {}" (17 chars) starts at offset 13 (after "const x = 1;\n", 13 chars).
    const tree: RawNavigationTree = {
      text: '<global>',
      kind: 'module',
      childItems: [{ text: 'bar', kind: 'function', spans: [{ start: 13, length: 17 }] }],
    };
    const [sym] = convertNavigationTree(tree, makeOffsetToPosition(source));
    expect(sym.startLine).toBe(2);
    expect(sym.startColumn).toBe(1);
    expect(sym.endLine).toBe(2);
    expect(sym.endColumn).toBe(18);
  });

  it('recursively converts nested childItems (e.g. class methods)', () => {
    const source = 'class Foo {\n  bar() {}\n}\n';
    const tree: RawNavigationTree = {
      text: '<global>',
      kind: 'module',
      childItems: [
        {
          text: 'Foo',
          kind: 'class',
          spans: [{ start: 0, length: 25 }],
          childItems: [{ text: 'bar', kind: 'method', spans: [{ start: 14, length: 8 }] }],
        },
      ],
    };
    const [classSym] = convertNavigationTree(tree, makeOffsetToPosition(source));
    expect(classSym.children).toHaveLength(1);
    expect(classSym.children[0].name).toBe('bar');
    expect(classSym.children[0].kind).toBe('method');
  });

  it('handles a node with no spans by defaulting to line 1, column 1', () => {
    const tree: RawNavigationTree = { text: '<global>', kind: 'module', childItems: [{ text: 'weird', kind: 'function' }] };
    const [sym] = convertNavigationTree(tree, makeOffsetToPosition(''));
    expect(sym.startLine).toBe(1);
    expect(sym.startColumn).toBe(1);
  });

  it('returns an empty array for a root with no childItems', () => {
    const tree: RawNavigationTree = { text: '<global>', kind: 'module' };
    expect(convertNavigationTree(tree, makeOffsetToPosition(''))).toEqual([]);
  });
});

describe('findSymbolAtPosition', () => {
  const symbols = [
    {
      name: 'Foo',
      kind: 'class',
      startLine: 1,
      startColumn: 1,
      endLine: 10,
      endColumn: 2,
      children: [
        { name: 'bar', kind: 'method', startLine: 2, startColumn: 3, endLine: 4, endColumn: 4, children: [] },
        { name: 'baz', kind: 'method', startLine: 5, startColumn: 3, endLine: 7, endColumn: 4, children: [] },
      ],
    },
  ];

  it('returns the innermost (child) symbol when the cursor is inside a nested method', () => {
    expect(findSymbolAtPosition(symbols, 3, 5)?.name).toBe('bar');
  });

  it('returns the outer symbol when the cursor is inside it but not inside any child', () => {
    expect(findSymbolAtPosition(symbols, 8, 1)?.name).toBe('Foo');
  });

  it('returns null when the cursor is outside every symbol', () => {
    expect(findSymbolAtPosition(symbols, 20, 1)).toBeNull();
  });

  it('respects the exact start/end column boundaries on the boundary lines', () => {
    // Before bar's startColumn 3 on its start line — outside bar, but still
    // within the outer Foo class's own range, so it falls back to Foo.
    expect(findSymbolAtPosition(symbols, 2, 2)?.name).toBe('Foo');
    expect(findSymbolAtPosition(symbols, 2, 3)?.name).toBe('bar'); // exactly at startColumn
    expect(findSymbolAtPosition(symbols, 4, 4)?.name).toBe('bar'); // exactly at endColumn
    expect(findSymbolAtPosition(symbols, 4, 5)?.name).toBe('Foo'); // past bar's endColumn, falls back to enclosing Foo
  });

  it('returns an empty array in, not null, when called with no symbols', () => {
    expect(findSymbolAtPosition([], 1, 1)).toBeNull();
  });
});

describe('flattenSymbols', () => {
  it('flattens a nested tree depth-first with correct depth values', () => {
    const symbols = [
      {
        name: 'Foo',
        kind: 'class',
        startLine: 1,
        startColumn: 1,
        endLine: 10,
        endColumn: 2,
        children: [{ name: 'bar', kind: 'method', startLine: 2, startColumn: 1, endLine: 3, endColumn: 2, children: [] }],
      },
      { name: 'topLevelFn', kind: 'function', startLine: 12, startColumn: 1, endLine: 14, endColumn: 2, children: [] },
    ];
    const flat = flattenSymbols(symbols);
    expect(flat.map((f) => [f.symbol.name, f.depth])).toEqual([
      ['Foo', 0],
      ['bar', 1],
      ['topLevelFn', 0],
    ]);
  });

  it('returns an empty array for an empty tree', () => {
    expect(flattenSymbols([])).toEqual([]);
  });
});
