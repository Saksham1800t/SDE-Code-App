/**
 * Multibuffers: one synthetic, editable Monaco document assembled from
 * excerpts of several real files, edited in place, and written back to
 * their real source files on Save — Monaco has no native concept of this
 * (unlike Zed's own text engine), so this module owns it directly.
 *
 * Known, deliberate MVP scope limits:
 *  - One Monaco language for the whole document (detected from the first
 *    excerpt's file — see MultibufferPanel.tsx), not per-excerpt — Monaco
 *    models are single-language, and per-excerpt embedded editors is a
 *    materially bigger feature than this MVP is scoped to.
 *  - Header lines ("// —— path:10-18 ——") are real text in the model, not
 *    enforced read-only — editing one doesn't corrupt anything (headers
 *    aren't part of any excerpt's tracked range, so edits to them are
 *    simply never written anywhere), but nothing stops the user from doing
 *    it. A real read-only-region implementation is a follow-up, not a
 *    correctness requirement for this MVP.
 */

export interface MultibufferExcerptSource {
  filePath: string;
  relativePath: string;
  /** 1-indexed, inclusive — the ORIGINAL file's line bounds at capture time. Never mutated after the excerpt is captured; buildMultibufferDocument returns a resolved (clamped) copy, not this one. */
  startLine: number;
  endLine: number;
}

export interface MultibufferExcerptRange {
  source: MultibufferExcerptSource;
  /** 1-indexed line, within the synthetic document, of this excerpt's header line. */
  headerLine: number;
  /** 1-indexed, inclusive — this excerpt's content lines within the synthetic document at BUILD time. Only used as the initial decoration range; MultibufferPanel.tsx queries the live decoration for the current range after edits. */
  docStartLine: number;
  docEndLine: number;
}

export interface MultibufferDocument {
  text: string;
  excerpts: MultibufferExcerptRange[];
}

export function formatExcerptHeader(source: MultibufferExcerptSource): string {
  return `// —— ${source.relativePath}:${source.startLine}-${source.endLine} ——`;
}

/** Splits on \n or \r\n without keeping the line-ending characters — matches how Monaco's own getValueInRange/split-by-line behaves, so line counts computed here line up with what the editor reports later. */
function splitLines(content: string): string[] {
  return content.split(/\r\n|\n/);
}

export function buildMultibufferDocument(
  sources: MultibufferExcerptSource[],
  fileContents: Map<string, string>,
): MultibufferDocument {
  const excerpts: MultibufferExcerptRange[] = [];
  const outLines: string[] = [];

  for (const source of sources) {
    const fileLines = splitLines(fileContents.get(source.filePath) ?? '');
    const start = Math.max(1, Math.min(source.startLine, fileLines.length || 1));
    const end = Math.max(start, Math.min(source.endLine, fileLines.length || 1));
    const resolvedSource: MultibufferExcerptSource = { ...source, startLine: start, endLine: end };

    outLines.push(formatExcerptHeader(resolvedSource));
    const headerLine = outLines.length;

    const excerptLines = fileLines.slice(start - 1, end);
    const docStartLine = outLines.length + 1;
    outLines.push(...excerptLines);
    const docEndLine = outLines.length;

    excerpts.push({ source: resolvedSource, headerLine, docStartLine, docEndLine });
    outLines.push(''); // breathing room before the next excerpt's header
  }

  if (outLines.length > 0) outLines.pop(); // drop the trailing separator after the last excerpt
  return { text: outLines.join('\n'), excerpts };
}

/** Builds excerpt sources from search-in-files results — each match gets `contextLines` of surrounding context, and overlapping/adjacent ranges within the same file are merged so two nearby matches don't produce two overlapping excerpts. */
export function buildExcerptSourcesFromSearchResults(
  results: { file: string; relativePath: string; matches: { line: number }[] }[],
  contextLines = 3,
): MultibufferExcerptSource[] {
  const sources: MultibufferExcerptSource[] = [];
  for (const result of results) {
    if (result.matches.length === 0) continue;
    const ranges = result.matches
      .map((m) => ({ start: Math.max(1, m.line - contextLines), end: m.line + contextLines }))
      .sort((a, b) => a.start - b.start);

    const merged: { start: number; end: number }[] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end + 1) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ ...r });
      }
    }

    for (const m of merged) {
      sources.push({ filePath: result.file, relativePath: result.relativePath, startLine: m.start, endLine: m.end });
    }
  }
  return sources;
}

export interface MultibufferFileEdit {
  /** ORIGINAL (capture-time) line bounds — where this excerpt's content lives in the real file, not where it currently sits in the synthetic document. */
  startLine: number;
  endLine: number;
  newLines: string[];
}

export interface MultibufferWriteBack {
  filePath: string;
  /** Sorted descending by startLine — apply top-to-bottom so an earlier (higher-line-number) edit's splice never shifts a later (lower-line-number) edit's still-to-be-applied line numbers. */
  edits: MultibufferFileEdit[];
}

/** Groups each excerpt's live (possibly edited) content by source file, ready to splice into each file's current on-disk content. Caller supplies each excerpt's current text (read from the Monaco model via its tracked decoration range at save time — see MultibufferPanel.tsx). */
export function groupExcerptEditsByFile(
  excerpts: { source: MultibufferExcerptSource; currentLines: string[] }[],
): MultibufferWriteBack[] {
  const byFile = new Map<string, MultibufferFileEdit[]>();
  for (const { source, currentLines } of excerpts) {
    const list = byFile.get(source.filePath) ?? [];
    list.push({ startLine: source.startLine, endLine: source.endLine, newLines: currentLines });
    byFile.set(source.filePath, list);
  }
  return Array.from(byFile.entries()).map(([filePath, edits]) => ({
    filePath,
    edits: [...edits].sort((a, b) => b.startLine - a.startLine),
  }));
}

/** Splices a file's own excerpt edits into its CURRENT on-disk content (pass the freshly-read content, not a cached copy — the file may have changed since the excerpt was captured) and returns the new full file text. `edits` must already be sorted descending by startLine (groupExcerptEditsByFile does this). */
export function applyWriteBackToFileContent(originalContent: string, edits: MultibufferFileEdit[]): string {
  const lines = splitLines(originalContent);
  for (const edit of edits) {
    lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...edit.newLines);
  }
  return lines.join('\n');
}
