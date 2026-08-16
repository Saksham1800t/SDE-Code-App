export interface ReferenceResult {
  filePath: string;
  fileName: string;
  line: number;
  column: number;
  lineText: string;
  isWriteAccess: boolean;
}

/** Groups a flat reference list by file, preserving first-seen order — a Map rather than a Record so insertion order is guaranteed for rendering. */
export function groupReferencesByFile(results: ReferenceResult[]): Map<string, ReferenceResult[]> {
  const grouped = new Map<string, ReferenceResult[]>();
  for (const r of results) {
    const existing = grouped.get(r.filePath);
    if (existing) existing.push(r);
    else grouped.set(r.filePath, [r]);
  }
  return grouped;
}
