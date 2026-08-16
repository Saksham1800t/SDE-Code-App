import { describe, expect, it } from 'vitest';
import { formatSearchEditorDocument } from './searchEditorFormat';
import type { SearchInFilesOptions } from '@sde-code/protocol';

const baseOptions: SearchInFilesOptions = {
  caseSensitive: false,
  isRegex: false,
  wholeWord: false,
  includeGlob: '',
  excludeGlob: '',
};

describe('formatSearchEditorDocument', () => {
  it('renders a "no results" document when results are empty', () => {
    const doc = formatSearchEditorDocument('foo', baseOptions, []);
    expect(doc).toBe('# Query: foo\n\nNo results found.\n');
  });

  it('renders a single file with a single match', () => {
    const doc = formatSearchEditorDocument('foo', baseOptions, [
      { file: '/root/a.ts', relativePath: 'a.ts', matches: [{ line: 12, text: '  const foo = 1;', matchStart: 8, matchEnd: 11 }] },
    ]);
    expect(doc).toBe('# Query: foo\n# 1 result in 1 file\n\na.ts:\n  12: const foo = 1;\n');
  });

  it('renders multiple files separated by a blank line, each with all its matches', () => {
    const doc = formatSearchEditorDocument('foo', baseOptions, [
      { file: '/root/a.ts', relativePath: 'a.ts', matches: [{ line: 1, text: 'foo', matchStart: 0, matchEnd: 3 }] },
      { file: '/root/b.ts', relativePath: 'b.ts', matches: [
        { line: 2, text: 'foo bar', matchStart: 0, matchEnd: 3 },
        { line: 5, text: 'baz foo', matchStart: 4, matchEnd: 7 },
      ] },
    ]);
    expect(doc).toBe(
      '# Query: foo\n# 3 results in 2 files\n\na.ts:\n  1: foo\n\nb.ts:\n  2: foo bar\n  5: baz foo\n',
    );
  });

  it('includes an active Flags line only for enabled options, in a fixed order', () => {
    const doc = formatSearchEditorDocument('foo', { ...baseOptions, caseSensitive: true, isRegex: true }, []);
    expect(doc).toContain('# Flags: Case Sensitive, Regex\n');
    expect(doc).not.toContain('Whole Word');
  });

  it('omits the Flags line entirely when no flags are enabled', () => {
    const doc = formatSearchEditorDocument('foo', baseOptions, []);
    expect(doc).not.toContain('# Flags');
  });

  it('includes include/exclude glob lines only when set', () => {
    const doc = formatSearchEditorDocument('foo', { ...baseOptions, includeGlob: '*.ts', excludeGlob: 'node_modules' }, []);
    expect(doc).toContain('# Files to include: *.ts\n');
    expect(doc).toContain('# Files to exclude: node_modules\n');
  });

  it('trims leading/trailing whitespace from each match line\'s displayed text', () => {
    const doc = formatSearchEditorDocument('foo', baseOptions, [
      { file: '/root/a.ts', relativePath: 'a.ts', matches: [{ line: 1, text: '    foo   ', matchStart: 4, matchEnd: 7 }] },
    ]);
    expect(doc).toContain('  1: foo\n');
  });
});
