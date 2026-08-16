/** Converts a native OS path into a `file://` URL for direct rendering (e.g. ImagePreviewPanel). Uses `encodeURI`, not `encodeURIComponent`, since the latter would mangle a Windows drive letter's colon into `%3A`. */
export function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withScheme = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  return encodeURI(withScheme);
}
