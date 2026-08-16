import type { SearchFileResult, SearchInFilesOptions } from '@sde-code/protocol';

/** Renders search results as a plain-text document (VS Code's "Search Editor" format, simplified). Kept pure so both SearchPanel.tsx and SearchEditorPanel.tsx produce byte-identical output. */
export function formatSearchEditorDocument(
  query: string,
  options: SearchInFilesOptions,
  results: SearchFileResult[],
): string {
  const flags: string[] = [];
  if (options.caseSensitive) flags.push('Case Sensitive');
  if (options.wholeWord) flags.push('Whole Word');
  if (options.isRegex) flags.push('Regex');

  const headerLines = [
    `# Query: ${query}`,
    flags.length > 0 ? `# Flags: ${flags.join(', ')}` : null,
    options.includeGlob ? `# Files to include: ${options.includeGlob}` : null,
    options.excludeGlob ? `# Files to exclude: ${options.excludeGlob}` : null,
  ].filter((line): line is string => line !== null);

  const header = headerLines.join('\n');

  if (results.length === 0) {
    return `${header}\n\nNo results found.\n`;
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
  const summary = `# ${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${results.length} file${results.length !== 1 ? 's' : ''}`;

  const body = results
    .map((r) => `${r.relativePath}:\n${r.matches.map((m) => `  ${m.line}: ${m.text.trim()}`).join('\n')}`)
    .join('\n\n');

  return `${header}\n${summary}\n\n${body}\n`;
}
