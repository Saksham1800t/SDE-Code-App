import { describe, expect, it } from 'vitest';
import {
  buildMultibufferDocument,
  buildExcerptSourcesFromSearchResults,
  groupExcerptEditsByFile,
  applyWriteBackToFileContent,
  formatExcerptHeader,
} from './multibuffer';

describe('buildMultibufferDocument', () => {
  it('assembles a header + content block per excerpt, separated by a blank line', () => {
    const sources = [
      { filePath: '/a.ts', relativePath: 'a.ts', startLine: 2, endLine: 3 },
      { filePath: '/b.ts', relativePath: 'b.ts', startLine: 1, endLine: 1 },
    ];
    const fileContents = new Map([
      ['/a.ts', 'line1\nline2\nline3\nline4'],
      ['/b.ts', 'onlyline'],
    ]);

    const doc = buildMultibufferDocument(sources, fileContents);

    expect(doc.text).toBe(
      [formatExcerptHeader({ filePath: '/a.ts', relativePath: 'a.ts', startLine: 2, endLine: 3 }), 'line2', 'line3', '', formatExcerptHeader({ filePath: '/b.ts', relativePath: 'b.ts', startLine: 1, endLine: 1 }), 'onlyline'].join('\n'),
    );
    expect(doc.excerpts).toHaveLength(2);
    expect(doc.excerpts[0]).toMatchObject({ headerLine: 1, docStartLine: 2, docEndLine: 3 });
    expect(doc.excerpts[1]).toMatchObject({ headerLine: 5, docStartLine: 6, docEndLine: 6 });
  });

  it('clamps an excerpt whose requested range exceeds the file\'s actual line count', () => {
    const sources = [{ filePath: '/a.ts', relativePath: 'a.ts', startLine: 1, endLine: 100 }];
    const fileContents = new Map([['/a.ts', 'line1\nline2']]);

    const doc = buildMultibufferDocument(sources, fileContents);

    expect(doc.excerpts[0].source).toMatchObject({ startLine: 1, endLine: 2 });
  });

  it('handles CRLF line endings the same as LF', () => {
    const sources = [{ filePath: '/a.ts', relativePath: 'a.ts', startLine: 1, endLine: 2 }];
    const fileContents = new Map([['/a.ts', 'line1\r\nline2\r\nline3']]);

    const doc = buildMultibufferDocument(sources, fileContents);

    expect(doc.text).toContain('line1\nline2');
  });
});

describe('buildExcerptSourcesFromSearchResults', () => {
  it('surrounds each match with context lines', () => {
    const results = [{ file: '/a.ts', relativePath: 'a.ts', matches: [{ line: 10 }] }];

    const sources = buildExcerptSourcesFromSearchResults(results, 3);

    expect(sources).toEqual([{ filePath: '/a.ts', relativePath: 'a.ts', startLine: 7, endLine: 13 }]);
  });

  it('merges two nearby matches in the same file into one excerpt instead of two overlapping ones', () => {
    const results = [{ file: '/a.ts', relativePath: 'a.ts', matches: [{ line: 10 }, { line: 12 }] }];

    const sources = buildExcerptSourcesFromSearchResults(results, 3);

    expect(sources).toEqual([{ filePath: '/a.ts', relativePath: 'a.ts', startLine: 7, endLine: 15 }]);
  });

  it('keeps two far-apart matches in the same file as separate excerpts', () => {
    const results = [{ file: '/a.ts', relativePath: 'a.ts', matches: [{ line: 10 }, { line: 100 }] }];

    const sources = buildExcerptSourcesFromSearchResults(results, 3);

    expect(sources).toEqual([
      { filePath: '/a.ts', relativePath: 'a.ts', startLine: 7, endLine: 13 },
      { filePath: '/a.ts', relativePath: 'a.ts', startLine: 97, endLine: 103 },
    ]);
  });

  it('clamps the start of a match near the top of the file instead of going negative', () => {
    const results = [{ file: '/a.ts', relativePath: 'a.ts', matches: [{ line: 1 }] }];

    const sources = buildExcerptSourcesFromSearchResults(results, 3);

    expect(sources[0].startLine).toBe(1);
  });
});

describe('groupExcerptEditsByFile + applyWriteBackToFileContent', () => {
  it('writes a single excerpt\'s edited content back into its original line range', () => {
    const excerpts = [{
      source: { filePath: '/a.ts', relativePath: 'a.ts', startLine: 2, endLine: 2 },
      currentLines: ['EDITED'],
    }];

    const [writeBack] = groupExcerptEditsByFile(excerpts);
    const result = applyWriteBackToFileContent('line1\nline2\nline3', writeBack.edits);

    expect(result).toBe('line1\nEDITED\nline3');
  });

  it('correctly applies two excerpts from the same file even when one edit changes the line count, by applying edits bottom-to-top', () => {
    // Two excerpts from the same file: lines 2-2 and lines 5-5. The first excerpt's edit
    // ADDS a line — if edits were applied top-to-bottom naively, the second excerpt's
    // "line 5" would no longer be correct after the splice. Sorting descending (bottom-to-top)
    // is exactly what avoids this.
    const excerpts = [
      { source: { filePath: '/a.ts', relativePath: 'a.ts', startLine: 2, endLine: 2 }, currentLines: ['two-a', 'two-b'] },
      { source: { filePath: '/a.ts', relativePath: 'a.ts', startLine: 5, endLine: 5 }, currentLines: ['FIVE-EDITED'] },
    ];

    const [writeBack] = groupExcerptEditsByFile(excerpts);
    expect(writeBack.edits.map((e) => e.startLine)).toEqual([5, 2]); // descending

    const original = 'one\ntwo\nthree\nfour\nfive';
    const result = applyWriteBackToFileContent(original, writeBack.edits);

    expect(result).toBe('one\ntwo-a\ntwo-b\nthree\nfour\nFIVE-EDITED');
  });

  it('groups excerpts from different files separately', () => {
    const excerpts = [
      { source: { filePath: '/a.ts', relativePath: 'a.ts', startLine: 1, endLine: 1 }, currentLines: ['A'] },
      { source: { filePath: '/b.ts', relativePath: 'b.ts', startLine: 1, endLine: 1 }, currentLines: ['B'] },
    ];

    const writeBacks = groupExcerptEditsByFile(excerpts);

    expect(writeBacks.map((w) => w.filePath).sort()).toEqual(['/a.ts', '/b.ts']);
  });

  it('a deleted excerpt (empty currentLines from a collapsed range) removes those lines from the file', () => {
    const excerpts = [{
      source: { filePath: '/a.ts', relativePath: 'a.ts', startLine: 2, endLine: 2 },
      currentLines: [''],
    }];

    const [writeBack] = groupExcerptEditsByFile(excerpts);
    const result = applyWriteBackToFileContent('line1\nline2\nline3', writeBack.edits);

    expect(result).toBe('line1\n\nline3');
  });
});
