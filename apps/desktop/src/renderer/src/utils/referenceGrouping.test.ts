import { describe, expect, it } from 'vitest';
import { groupReferencesByFile, type ReferenceResult } from './referenceGrouping';

const ref = (over: Partial<ReferenceResult>): ReferenceResult => ({
  filePath: 'a.ts',
  fileName: 'a.ts',
  line: 1,
  column: 1,
  lineText: '',
  isWriteAccess: false,
  ...over,
});

describe('groupReferencesByFile', () => {
  it('returns an empty map for an empty list', () => {
    expect(groupReferencesByFile([]).size).toBe(0);
  });

  it('groups multiple references to the same file under one key', () => {
    const grouped = groupReferencesByFile([
      ref({ filePath: 'a.ts', line: 1 }),
      ref({ filePath: 'a.ts', line: 5 }),
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get('a.ts')).toHaveLength(2);
  });

  it('preserves first-seen file order even when references interleave', () => {
    const grouped = groupReferencesByFile([
      ref({ filePath: 'b.ts', line: 1 }),
      ref({ filePath: 'a.ts', line: 1 }),
      ref({ filePath: 'b.ts', line: 2 }),
    ]);
    expect(Array.from(grouped.keys())).toEqual(['b.ts', 'a.ts']);
    expect(grouped.get('b.ts')).toHaveLength(2);
  });

  it('preserves each file\'s reference order', () => {
    const grouped = groupReferencesByFile([
      ref({ filePath: 'a.ts', line: 10 }),
      ref({ filePath: 'a.ts', line: 3 }),
    ]);
    expect(grouped.get('a.ts')!.map((r) => r.line)).toEqual([10, 3]);
  });
});
