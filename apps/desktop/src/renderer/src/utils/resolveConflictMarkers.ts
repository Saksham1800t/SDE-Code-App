export type ConflictResolution = 'current' | 'incoming' | 'both';

// Standard git 3-way conflict marker format. Optional "|||||||" base section is treated as part of "current". Uses `\r?\n` throughout since a CRLF-blind regex silently no-ops on Windows-written markers.
const CONFLICT_BLOCK = /<<<<<<<[^\r\n]*\r?\n([\s\S]*?)(?:\|\|\|\|\|\|\|[^\r\n]*\r?\n[\s\S]*?)?\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>[^\r\n]*(\r?\n)?/g;

export function countConflictBlocks(content: string): number {
  const matches = content.match(new RegExp(CONFLICT_BLOCK.source, 'g'));
  return matches ? matches.length : 0;
}

/** Applies one resolution to every conflict block in the file uniformly (a per-file bulk action, not per-block). */
export function resolveConflictMarkers(content: string, resolution: ConflictResolution): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return content.replace(CONFLICT_BLOCK, (_match, current: string, incoming: string, trailingNewline: string | undefined) => {
    const keep = resolution === 'current' ? current : resolution === 'incoming' ? incoming : `${current}${eol}${incoming}`;
    // Only re-add a trailing newline if the original match had one — unconditionally appending one corrupts files with no final newline.
    return trailingNewline ? `${keep}${eol}` : keep;
  });
}
