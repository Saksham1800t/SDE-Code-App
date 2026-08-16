import { describe, expect, it } from 'vitest';
import { applyRenameToText, groupRenameLocationsByFile } from './bulkRename';

describe('applyRenameToText', () => {
  it('replaces a single span with the new name', () => {
    const text = 'const foo = 1;';
    // "foo" starts at offset 6, length 3
    expect(applyRenameToText(text, [{ start: 6, length: 3 }], 'bar')).toBe('const bar = 1;');
  });

  it('replaces multiple spans in one file, regardless of input order', () => {
    const text = 'foo(1); foo(2);';
    // Second "foo" at offset 8, first at offset 0 — pass out of order.
    const spans = [{ start: 8, length: 3 }, { start: 0, length: 3 }];
    expect(applyRenameToText(text, spans, 'bar')).toBe('bar(1); bar(2);');
  });

  it('handles a replacement name of a different length without corrupting later spans', () => {
    const text = 'x(1); x(2); x(3);';
    const spans = [{ start: 0, length: 1 }, { start: 6, length: 1 }, { start: 12, length: 1 }];
    expect(applyRenameToText(text, spans, 'muchLongerName')).toBe(
      'muchLongerName(1); muchLongerName(2); muchLongerName(3);',
    );
  });

  it('returns the original text unchanged when there are no spans', () => {
    expect(applyRenameToText('const foo = 1;', [], 'bar')).toBe('const foo = 1;');
  });
});

describe('groupRenameLocationsByFile', () => {
  it('returns an empty map for an empty list', () => {
    expect(groupRenameLocationsByFile([]).size).toBe(0);
  });

  it('groups locations by fileName, preserving first-seen file order', () => {
    const grouped = groupRenameLocationsByFile([
      { fileName: 'b.ts', textSpan: { start: 0, length: 3 } },
      { fileName: 'a.ts', textSpan: { start: 5, length: 3 } },
      { fileName: 'b.ts', textSpan: { start: 10, length: 3 } },
    ]);
    expect(Array.from(grouped.keys())).toEqual(['b.ts', 'a.ts']);
    expect(grouped.get('b.ts')).toHaveLength(2);
    expect(grouped.get('a.ts')).toHaveLength(1);
  });
});
