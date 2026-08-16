import { describe, it, expect } from 'vitest';
import { mapMarkersToProblems, sortProblems, severityFromMonaco, formatProblemsSummary, ProblemEntry } from './problems';

const marker = (overrides: Partial<{
  resource: { fsPath: string };
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source: string;
}>) => ({
  resource: { fsPath: 'D:\\repo\\a.ts' },
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 5,
  message: 'msg',
  severity: 8,
  ...overrides,
});

describe('severityFromMonaco', () => {
  it('maps Monaco MarkerSeverity numeric values to string severities', () => {
    expect(severityFromMonaco(8)).toBe('error');
    expect(severityFromMonaco(4)).toBe('warning');
    expect(severityFromMonaco(2)).toBe('info');
    expect(severityFromMonaco(1)).toBe('hint');
  });
});

describe('mapMarkersToProblems', () => {
  it('normalizes a native Windows fsPath (backslashes) to forward slashes', () => {
    const [entry] = mapMarkersToProblems([marker({ resource: { fsPath: 'D:\\repo\\src\\a.ts' } })]);
    expect(entry.filePath).toBe('D:/repo/src/a.ts');
    expect(entry.fileName).toBe('a.ts');
  });

  it('carries over line/column/message/severity/source fields', () => {
    const [entry] = mapMarkersToProblems([marker({
      startLineNumber: 12, startColumn: 3, endLineNumber: 12, endColumn: 9,
      message: 'Cannot find name "foo".', severity: 8, source: 'ts',
    })]);
    expect(entry).toMatchObject({
      line: 12, column: 3, endLine: 12, endColumn: 9,
      message: 'Cannot find name "foo".', severity: 'error', source: 'ts',
    });
  });
});

describe('sortProblems', () => {
  it('within one file, sorts errors before warnings before info, then by position', () => {
    const entries: ProblemEntry[] = [
      { filePath: 'a.ts', fileName: 'a.ts', line: 5, column: 1, endLine: 5, endColumn: 2, message: 'warn', severity: 'warning' },
      { filePath: 'a.ts', fileName: 'a.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'err-late-line', severity: 'error' },
      { filePath: 'a.ts', fileName: 'a.ts', line: 2, column: 10, endLine: 2, endColumn: 11, message: 'info', severity: 'info' },
      { filePath: 'a.ts', fileName: 'a.ts', line: 1, column: 2, endLine: 1, endColumn: 3, message: 'err-earlier-col', severity: 'error' },
    ];
    const sorted = sortProblems(entries);
    expect(sorted.map((e) => e.message)).toEqual(['err-late-line', 'err-earlier-col', 'warn', 'info']);
  });

  it('across files, sorts by each file worst severity first', () => {
    const entries: ProblemEntry[] = [
      { filePath: 'clean-but-warns.ts', fileName: 'clean-but-warns.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'w', severity: 'warning' },
      { filePath: 'has-error.ts', fileName: 'has-error.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'e', severity: 'error' },
    ];
    const sorted = sortProblems(entries);
    expect(sorted.map((e) => e.filePath)).toEqual(['has-error.ts', 'clean-but-warns.ts']);
  });

  it('across files with the same worst severity, sorts alphabetically by path', () => {
    const entries: ProblemEntry[] = [
      { filePath: 'z.ts', fileName: 'z.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'e', severity: 'error' },
      { filePath: 'a.ts', fileName: 'a.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'e', severity: 'error' },
    ];
    const sorted = sortProblems(entries);
    expect(sorted.map((e) => e.filePath)).toEqual(['a.ts', 'z.ts']);
  });

  it('keeps all of one file\'s entries grouped together even when interleaved across severities from another file', () => {
    const entries: ProblemEntry[] = [
      { filePath: 'b.ts', fileName: 'b.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'b-warn', severity: 'warning' },
      { filePath: 'a.ts', fileName: 'a.ts', line: 1, column: 1, endLine: 1, endColumn: 2, message: 'a-error', severity: 'error' },
      { filePath: 'b.ts', fileName: 'b.ts', line: 2, column: 1, endLine: 2, endColumn: 2, message: 'b-error', severity: 'error' },
    ];
    const sorted = sortProblems(entries);
    // b.ts has an error too, so its worst rank ties with a.ts's — alphabetical
    // tiebreak puts a.ts first, but b.ts's own two entries must stay adjacent.
    expect(sorted.map((e) => e.message)).toEqual(['a-error', 'b-error', 'b-warn']);
  });
});

describe('formatProblemsSummary', () => {
  it('pluralizes both nouns when counts are 0 or more than 1', () => {
    expect(formatProblemsSummary(0, 0)).toBe('0 errors, 0 warnings');
    expect(formatProblemsSummary(2, 3)).toBe('2 errors, 3 warnings');
  });

  it('uses the singular noun when a count is exactly 1', () => {
    expect(formatProblemsSummary(1, 0)).toBe('1 error, 0 warnings');
    expect(formatProblemsSummary(0, 1)).toBe('0 errors, 1 warning');
    expect(formatProblemsSummary(1, 1)).toBe('1 error, 1 warning');
  });
});
