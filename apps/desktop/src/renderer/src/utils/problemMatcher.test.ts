import { describe, expect, it } from 'vitest';
import { matchProblemLines, stripAnsi } from './problemMatcher';

describe('stripAnsi', () => {
  it('removes SGR color escape sequences', () => {
    expect(stripAnsi('\x1b[31merror\x1b[0m TS2345: bad')).toBe('error TS2345: bad');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('no colors here')).toBe('no colors here');
  });

  it('removes cursor-visibility (DECTCEM) sequences, not just SGR color codes', () => {
    // Regression test: caught live running a real task — PowerShell/Node
    // wrap output in \x1b[?25l (hide cursor) / \x1b[?25h (show cursor),
    // final byte 'l'/'h' with a literal '?', which an SGR-only ('...m')
    // regex doesn't match — the literal text "[?25h" leaked straight into a
    // matched file path in the Problems panel.
    expect(stripAnsi('\x1b[?25lsrc/foo.ts\x1b[?25h')).toBe('src/foo.ts');
  });
});

describe('matchProblemLines', () => {
  it("returns nothing for matcher 'none' regardless of content", () => {
    expect(matchProblemLines(['src/a.ts(1,1): error TS1: bad'], 'none', '/repo')).toEqual([]);
  });

  describe('tsc', () => {
    it('parses a single relative-path error line', () => {
      const entries = matchProblemLines(['src/foo.ts(12,5): error TS2345: Argument of type mismatch.'], 'tsc', '/repo');
      expect(entries).toEqual([
        {
          filePath: '/repo/src/foo.ts',
          fileName: 'foo.ts',
          line: 12,
          column: 5,
          endLine: 12,
          endColumn: 6,
          message: 'TS2345: Argument of type mismatch.',
          severity: 'error',
          source: 'tsc',
        },
      ]);
    });

    it('parses a warning severity line', () => {
      const [entry] = matchProblemLines(['src/foo.ts(1,1): warning TS6133: unused var.'], 'tsc', '/repo');
      expect(entry.severity).toBe('warning');
    });

    it('keeps an already-absolute Windows path unchanged (just forward-slashed)', () => {
      const [entry] = matchProblemLines(['C:\\repo\\src\\foo.ts(1,1): error TS1: bad'], 'tsc', 'C:\\repo');
      expect(entry.filePath).toBe('C:/repo/src/foo.ts');
    });

    it('strips ANSI codes before matching (FORCE_COLOR=1 terminal output)', () => {
      const coloredLine = 'src/foo.ts\x1b[90m(12,5)\x1b[0m: \x1b[91merror\x1b[0m TS2345: bad';
      const entries = matchProblemLines([coloredLine], 'tsc', '/repo');
      expect(entries).toHaveLength(1);
      expect(entries[0].line).toBe(12);
    });

    it('ignores non-diagnostic lines (summary lines, blank lines, plain command echo)', () => {
      const entries = matchProblemLines(['Found 2 errors in 1 file.', '', 'tsc --noEmit'], 'tsc', '/repo');
      expect(entries).toEqual([]);
    });

    it('parses multiple diagnostics across multiple files', () => {
      const entries = matchProblemLines(
        ['a.ts(1,1): error TS1: first', 'b.ts(2,2): warning TS2: second'],
        'tsc',
        '/repo',
      );
      expect(entries).toHaveLength(2);
      expect(entries[0].filePath).toBe('/repo/a.ts');
      expect(entries[1].filePath).toBe('/repo/b.ts');
    });
  });

  describe('eslint', () => {
    it('parses one file with one diagnostic including the rule id', () => {
      const lines = ['/repo/src/foo.js', '  12:5  error  Missing semicolon  semi'];
      const entries = matchProblemLines(lines, 'eslint', '/repo');
      expect(entries).toEqual([
        {
          filePath: '/repo/src/foo.js',
          fileName: 'foo.js',
          line: 12,
          column: 5,
          endLine: 12,
          endColumn: 6,
          message: 'Missing semicolon (semi)',
          severity: 'error',
          source: 'eslint',
        },
      ]);
    });

    it('parses a diagnostic line with no rule id (message only)', () => {
      const lines = ['/repo/src/foo.js', '  1:1  error  Parsing error: Unexpected token'];
      const [entry] = matchProblemLines(lines, 'eslint', '/repo');
      expect(entry.message).toBe('Parsing error: Unexpected token');
    });

    it('tracks the current file across multiple diagnostics under the same header', () => {
      const lines = ['/repo/src/foo.js', '  1:1  error  first  rule-a', '  2:2  warning  second  rule-b'];
      const entries = matchProblemLines(lines, 'eslint', '/repo');
      expect(entries).toHaveLength(2);
      expect(entries[0].filePath).toBe('/repo/src/foo.js');
      expect(entries[1].filePath).toBe('/repo/src/foo.js');
      expect(entries[1].severity).toBe('warning');
    });

    it('switches to a new current file when a second file header appears', () => {
      const lines = ['/repo/src/a.js', '  1:1  error  in-a  rule', '/repo/src/b.js', '  2:2  error  in-b  rule'];
      const entries = matchProblemLines(lines, 'eslint', '/repo');
      expect(entries.map((e) => e.filePath)).toEqual(['/repo/src/a.js', '/repo/src/b.js']);
    });

    it('ignores diagnostic-shaped lines that appear before any file header', () => {
      const entries = matchProblemLines(['  1:1  error  orphan  rule'], 'eslint', '/repo');
      expect(entries).toEqual([]);
    });

    it('ignores summary lines (e.g. "\u2716 3 problems (2 errors, 1 warning)")', () => {
      const lines = ['/repo/src/foo.js', '  1:1  error  first  rule', '', '\u2716 1 problem (1 error, 0 warnings)'];
      const entries = matchProblemLines(lines, 'eslint', '/repo');
      expect(entries).toHaveLength(1);
    });
  });
});
