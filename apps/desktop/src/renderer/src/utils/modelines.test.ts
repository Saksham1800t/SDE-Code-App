import { describe, expect, it } from 'vitest';
import { parseModelines } from './modelines';

describe('parseModelines — Vim convention', () => {
  it('parses a line-comment modeline with tabstop and expandtab', () => {
    const content = '// vim: ts=4 et\nconst x = 1;\n';
    expect(parseModelines(content)).toEqual({ tabSize: 4, insertSpaces: true });
  });

  it('parses a block-comment modeline with the "set" keyword and a trailing colon', () => {
    const content = '/* vim: set ts=2 sw=2 et: */\nconst x = 1;\n';
    expect(parseModelines(content)).toEqual({ tabSize: 2, insertSpaces: true });
  });

  it('parses a colon-delimited modeline (no spaces)', () => {
    const content = '# vim:ts=8:noet\nprint(1)\n';
    expect(parseModelines(content)).toEqual({ tabSize: 8, insertSpaces: false });
  });

  it('falls back to shiftwidth when tabstop is absent', () => {
    const content = '// vim: sw=3\nconst x = 1;\n';
    expect(parseModelines(content)).toEqual({ tabSize: 3 });
  });

  it('prefers tabstop over shiftwidth when both are present', () => {
    const content = '// vim: sw=2 ts=4\nconst x = 1;\n';
    expect(parseModelines(content).tabSize).toBe(4);
  });

  it('parses wrap/nowrap', () => {
    expect(parseModelines('// vim: wrap\n')).toEqual({ wordWrap: 'on' });
    expect(parseModelines('// vim: nowrap\n')).toEqual({ wordWrap: 'off' });
  });
});

describe('parseModelines — Emacs convention', () => {
  it('parses tab-width and indent-tabs-mode: nil (spaces)', () => {
    const content = '// -*- tab-width: 4; indent-tabs-mode: nil; -*-\nconst x = 1;\n';
    expect(parseModelines(content)).toEqual({ tabSize: 4, insertSpaces: true });
  });

  it('parses indent-tabs-mode: t (tabs)', () => {
    const content = '// -*- indent-tabs-mode: t; -*-\nconst x = 1;\n';
    expect(parseModelines(content)).toEqual({ insertSpaces: false });
  });
});

describe('parseModelines — scope and edge cases', () => {
  it('returns {} when no modeline is present', () => {
    expect(parseModelines('const x = 1;\nfunction foo() {}\n')).toEqual({});
  });

  it('only scans the first/last few lines, ignoring a modeline-shaped comment buried in the middle of a long file', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    lines[20] = '// vim: ts=99'; // buried well outside the head/tail scan window
    expect(parseModelines(lines.join('\n'))).toEqual({});
  });

  it('finds a modeline on the last line of a long file (tail scan)', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    lines.push('// vim: ts=6 et');
    expect(parseModelines(lines.join('\n'))).toEqual({ tabSize: 6, insertSpaces: true });
  });

  it('is case-insensitive on the vim: marker', () => {
    expect(parseModelines('// VIM: ts=4\n')).toEqual({ tabSize: 4 });
  });
});
