import { describe, expect, it } from 'vitest';
import { applyInlineChatEdit, buildInlineChatPrompt } from './inlineChatPrompt';

describe('buildInlineChatPrompt', () => {
  it('builds a selection-replace prompt including the full file, the selected snippet, and the instruction', () => {
    const prompt = buildInlineChatPrompt({
      fileContent: 'function f() {\n  return 1;\n}\n',
      languageId: 'typescript',
      instruction: 'add input validation',
      selectedText: 'return 1;',
      cursorOffset: 20,
    });

    // fileContent already ends in '\n', and the template adds its own '\n'
    // before the closing fence, so there's a doubled newline here — cosmetic
    // (an LLM doesn't care about a stray blank line before a fence), not
    // worth restructuring the template to avoid.
    expect(prompt).toContain('```typescript\nfunction f() {\n  return 1;\n}\n\n```');
    expect(prompt).toContain('```typescript\nreturn 1;\n```');
    expect(prompt).toContain('Instructions: add input validation');
    expect(prompt).toContain('Output ONLY the replacement code for the selected snippet');
    expect(prompt).not.toContain('<<<CURSOR>>>');
  });

  it('builds a cursor-insert prompt with a <<<CURSOR>>> marker at the given offset, when selectedText is null', () => {
    const prompt = buildInlineChatPrompt({
      fileContent: 'function f() {\n\n}\n',
      languageId: 'typescript',
      instruction: 'add a return statement',
      selectedText: null,
      cursorOffset: 15, // right after "function f() {\n"
    });

    expect(prompt).toContain('function f() {\n<<<CURSOR>>>\n}\n');
    expect(prompt).toContain('Instructions: add a return statement');
    expect(prompt).toContain('Output ONLY the code to insert at the <<<CURSOR>>> position');
    expect(prompt).not.toContain('selected this exact snippet');
  });

  it('treats an empty-string selection the same as a real selection, not a cursor-insert', () => {
    // Distinguishing "no selection" (null) from "an empty selection" (never
    // actually reachable via editor.getSelection().isEmpty(), but worth
    // locking in the null-check semantics explicitly) — only `null` should
    // switch to insert-mode.
    const prompt = buildInlineChatPrompt({
      fileContent: 'const x = 1;',
      languageId: 'typescript',
      instruction: 'do nothing',
      selectedText: '',
      cursorOffset: 0,
    });

    expect(prompt).toContain('selected this exact snippet');
    expect(prompt).not.toContain('<<<CURSOR>>>');
  });
});

describe('applyInlineChatEdit', () => {
  it('replaces a mid-file range with the given replacement', () => {
    // Offsets 6-11 span "x = 1" (offset 6 is 'x', offset 11 is ';').
    const result = applyInlineChatEdit('const x = 1;\nconst y = 2;\n', 6, 11, 'renamed');
    expect(result).toBe('const renamed;\nconst y = 2;\n');
  });

  it('inserts at a zero-width range (cursor-only insert, startOffset === endOffset)', () => {
    // Offset 15 is the start of the blank line 2 in "function f() {\n\n}\n" —
    // inserting there fills that blank line rather than adding a new one
    // (the blank line's own trailing '\n', preserved in the "after" slice,
    // is what puts "}" on its own line afterward).
    const result = applyInlineChatEdit('function f() {\n\n}\n', 15, 15, '  return 1;');
    expect(result).toBe('function f() {\n  return 1;\n}\n');
  });

  it('replaces the entire file when the range spans start to end', () => {
    const result = applyInlineChatEdit('old content', 0, 11, 'new content');
    expect(result).toBe('new content');
  });

  it('deletes the range when the replacement is an empty string', () => {
    // Offsets 6-8 span "x " (offset 6 is 'x', offset 7 is ' ', offset 8 is '=').
    const result = applyInlineChatEdit('const x = 1;', 6, 8, '');
    expect(result).toBe('const = 1;');
  });

  it('handles a replacement at the very start of the file', () => {
    const result = applyInlineChatEdit('hello world', 0, 5, 'goodbye');
    expect(result).toBe('goodbye world');
  });

  it('handles a replacement at the very end of the file', () => {
    const result = applyInlineChatEdit('hello world', 6, 11, 'there');
    expect(result).toBe('hello there');
  });
});
