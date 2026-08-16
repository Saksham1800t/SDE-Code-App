import { describe, expect, it } from 'vitest';
import { parseConflictBlocks, substituteBlocks } from './conflictResolution';

describe('parseConflictBlocks', () => {
  it('returns no blocks for content with no conflict markers', () => {
    expect(parseConflictBlocks('const x = 1;\nfunction f() {}\n')).toEqual([]);
  });

  it('parses a single 2-way conflict block with correct line numbers and sides', () => {
    const content = ['line1', '<<<<<<< HEAD', 'ours line', '=======', 'theirs line', '>>>>>>> feature', 'line7'].join('\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks).toEqual([
      { startLine: 2, endLine: 6, ours: 'ours line', theirs: 'theirs line' },
    ]);
  });

  it('parses a diff3-style block, keeping ours/theirs and exposing the base section', () => {
    const content = ['<<<<<<< HEAD', 'ours line', '||||||| base', 'base line', '=======', 'theirs line', '>>>>>>> feature'].join('\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks).toEqual([{ startLine: 1, endLine: 7, ours: 'ours line', theirs: 'theirs line', base: 'base line' }]);
  });

  it('a plain 2-way block has no base property at all (not just undefined)', () => {
    const content = ['<<<<<<< HEAD', 'ours line', '=======', 'theirs line', '>>>>>>> feature'].join('\n');

    const blocks = parseConflictBlocks(content);

    expect('base' in blocks[0]).toBe(false);
  });

  it('parses multiple conflict blocks in the same file independently', () => {
    const content = [
      '<<<<<<< HEAD',
      'a-ours',
      '=======',
      'a-theirs',
      '>>>>>>> feature',
      'unchanged',
      '<<<<<<< HEAD',
      'b-ours',
      '=======',
      'b-theirs',
      '>>>>>>> feature',
    ].join('\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ startLine: 1, endLine: 5, ours: 'a-ours', theirs: 'a-theirs' });
    expect(blocks[1]).toEqual({ startLine: 7, endLine: 11, ours: 'b-ours', theirs: 'b-theirs' });
  });

  it('supports a multi-line side on both ours and theirs', () => {
    const content = ['<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs 1', 'theirs 2', 'theirs 3', '>>>>>>> feature'].join('\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks).toEqual([{ startLine: 1, endLine: 8, ours: 'ours 1\nours 2', theirs: 'theirs 1\ntheirs 2\ntheirs 3' }]);
  });

  it('stops scanning at an unterminated block instead of misparsing the rest of the file', () => {
    const content = ['<<<<<<< HEAD', 'ours line', 'no separator or end marker here'].join('\n');

    expect(parseConflictBlocks(content)).toEqual([]);
  });

  it('handles an empty side (e.g. one branch deleted the content)', () => {
    const content = ['<<<<<<< HEAD', '=======', 'theirs line', '>>>>>>> feature'].join('\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks).toEqual([{ startLine: 1, endLine: 4, ours: '', theirs: 'theirs line' }]);
  });

  it('extracts sides with no embedded carriage returns from a CRLF file', () => {
    // Regression test: splitting on a bare '\n' leaves a stray trailing '\r'
    // on every extracted line for a CRLF file, which (once used as
    // replacement text dropped next to the untouched CRLF that follows the
    // original block) doubles into an extra blank line when applied via
    // Monaco's executeEdits — caught live: resolving a real CRLF conflict
    // produced "line\r\r\n}" instead of "line\r\n}".
    const content = ['function f() {', '<<<<<<< HEAD', '  return "ours";', '=======', '  return "theirs";', '>>>>>>> feature', '}', ''].join('\r\n');

    const blocks = parseConflictBlocks(content);

    expect(blocks).toEqual([{ startLine: 2, endLine: 6, ours: '  return "ours";', theirs: '  return "theirs";' }]);
    expect(blocks[0].ours).not.toContain('\r');
    expect(blocks[0].theirs).not.toContain('\r');
  });
});

describe('substituteBlocks', () => {
  it('replaces a single block with the ours side, keeping surrounding lines intact', () => {
    const content = ['before', '<<<<<<< HEAD', 'ours line', '=======', 'theirs line', '>>>>>>> feature', 'after'].join('\n');
    const blocks = parseConflictBlocks(content);

    expect(substituteBlocks(content, blocks, 'ours')).toBe('before\nours line\nafter');
    expect(substituteBlocks(content, blocks, 'theirs')).toBe('before\ntheirs line\nafter');
  });

  it('drops an empty side entirely rather than leaving a blank line', () => {
    const content = ['before', '<<<<<<< HEAD', '=======', 'theirs line', '>>>>>>> feature', 'after'].join('\n');
    const blocks = parseConflictBlocks(content);

    expect(substituteBlocks(content, blocks, 'ours')).toBe('before\nafter');
    expect(substituteBlocks(content, blocks, 'theirs')).toBe('before\ntheirs line\nafter');
  });

  it('substitutes multiple independent blocks in one pass', () => {
    const content = [
      '<<<<<<< HEAD', 'a-ours', '=======', 'a-theirs', '>>>>>>> feature',
      'unchanged',
      '<<<<<<< HEAD', 'b-ours', '=======', 'b-theirs', '>>>>>>> feature',
    ].join('\n');
    const blocks = parseConflictBlocks(content);

    expect(substituteBlocks(content, blocks, 'ours')).toBe('a-ours\nunchanged\nb-ours');
    expect(substituteBlocks(content, blocks, 'theirs')).toBe('a-theirs\nunchanged\nb-theirs');
  });

  it('returns the content unchanged when there are no blocks', () => {
    const content = 'plain\nfile\ncontent';
    expect(substituteBlocks(content, [], 'ours')).toBe(content);
  });

  it('substitutes a multi-line side as multiple lines, not one joined line', () => {
    const content = ['<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs 1', '>>>>>>> feature'].join('\n');
    const blocks = parseConflictBlocks(content);

    expect(substituteBlocks(content, blocks, 'ours')).toBe('ours 1\nours 2');
  });
});
