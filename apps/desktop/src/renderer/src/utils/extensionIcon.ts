const ICON_PALETTE = ['#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6', '#a855f7'];

/** Deterministic (same seed -> same letter/color everywhere) so a placeholder tile is stable without persisting or uploading anything, derived purely from the extension's id. */
export function getPlaceholderIcon(seed: string): { letter: string; color: string } {
  const trimmed = (seed || '?').trim();
  const letter = (trimmed[0] || '?').toUpperCase();
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  return { letter, color: ICON_PALETTE[hash % ICON_PALETTE.length] };
}
