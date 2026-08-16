export interface RenameTextSpan {
  start: number;
  length: number;
}

export interface RawRenameLocation {
  fileName: string;
  textSpan: RenameTextSpan;
}

/** Replaces every span in `text` with `newName` in one pass. Spans are sorted ascending first so each slice is taken from the original text, never already-rewritten output. */
export function applyRenameToText(text: string, spans: RenameTextSpan[], newName: string): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const span of sorted) {
    result += text.slice(cursor, span.start) + newName;
    cursor = span.start + span.length;
  }
  result += text.slice(cursor);
  return result;
}

/** Groups TS worker's flat RenameLocation[] by file, preserving first-seen
 * file order — same rationale as referenceGrouping.ts's groupReferencesByFile. */
export function groupRenameLocationsByFile(locations: RawRenameLocation[]): Map<string, RawRenameLocation[]> {
  const grouped = new Map<string, RawRenameLocation[]>();
  for (const loc of locations) {
    const existing = grouped.get(loc.fileName);
    if (existing) existing.push(loc);
    else grouped.set(loc.fileName, [loc]);
  }
  return grouped;
}
