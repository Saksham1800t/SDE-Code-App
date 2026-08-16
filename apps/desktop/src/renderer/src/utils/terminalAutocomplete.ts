/** Pure suggestion-matching logic for the terminal's Tab-to-complete feature — no xterm/Electron dependency, so every function here is unit-testable. TerminalArea.tsx calls straight through to these for every decision. */

export type CompletionKind = 'command' | 'path';

export interface DirEntryLike {
  name: string;
  isDirectory: boolean;
}

function looksLikePath(token: string): boolean {
  return token.includes('/') || token.includes('\\');
}

/** Which kind of completion applies to the currently typed text. 'command' only on the first word with no path separator; everything else is 'path'. Deliberately end-of-line only — doesn't account for arrow-key cursor movement. */
export function getCompletionKind(line: string): CompletionKind {
  const trimmed = line.replace(/^\s+/, '');
  const pastFirstWord = /\s/.test(trimmed);
  if (!pastFirstWord && !looksLikePath(trimmed)) return 'command';
  return 'path';
}

/** The token currently being typed — everything after the last run of whitespace, or the whole trimmed line if none. Empty when the line ends in whitespace or is empty. */
export function getCurrentToken(line: string): string {
  const trimmedStart = line.replace(/^\s+/, '');
  if (trimmedStart === '') return '';
  if (/\s$/.test(line)) return '';
  const parts = trimmedStart.split(/\s+/);
  return parts[parts.length - 1];
}

/** Splits a path-completion token into its directory portion (as typed) and the filename being completed. 'src/comp' -> { dirPart: 'src/', namePart: 'comp' }. */
export function splitPathToken(token: string): { dirPart: string; namePart: string } {
  const lastSepIdx = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  if (lastSepIdx === -1) return { dirPart: '', namePart: token };
  return { dirPart: token.slice(0, lastSepIdx + 1), namePart: token.slice(lastSepIdx + 1) };
}

/** Minimal join+normalize for terminal completion only — the renderer has no Node `path` module. Always returns forward slashes, which both PowerShell and POSIX shells accept. */
export function joinPath(base: string, relative: string): string {
  if (!relative) return base;
  const normalizedRelative = relative.replace(/\\/g, '/');
  if (normalizedRelative.startsWith('/') || /^[a-zA-Z]:/.test(normalizedRelative)) {
    return normalizedRelative;
  }
  const baseNormalized = base.replace(/\\/g, '/').replace(/\/+$/, '');
  const isWindowsAbsoluteBase = /^[a-zA-Z]:/.test(baseNormalized);
  const isPosixAbsoluteBase = baseNormalized.startsWith('/');

  const segments = `${baseNormalized}/${normalizedRelative}`.split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  const prefix = isPosixAbsoluteBase ? '/' : '';
  const joined = resolved.join('/');
  return isWindowsAbsoluteBase ? joined : prefix + joined;
}

/** Best-effort cwd tracking for a submitted `cd <target>` line, so path completion resolves correctly after navigating away. Bare `cd`/`cd ~` is left unresolved (no OSC7 shell-integration); only a simple quote pair is stripped. */
export function resolveCdTarget(currentCwd: string, submittedLine: string): string {
  const match = /^cd\s+(.+)$/i.exec(submittedLine.trim());
  if (!match) return currentCwd;
  const target = match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!target || target === '~') return currentCwd;
  return joinPath(currentCwd, target);
}

/** Case-insensitive prefix match, alphabetically sorted — the same core
 * matching rule for both command names and path entries. */
export function matchByPrefix(candidates: string[], partial: string): string[] {
  const lowerPartial = partial.toLowerCase();
  return candidates
    .filter((c) => c.toLowerCase().startsWith(lowerPartial))
    .sort((a, b) => a.localeCompare(b));
}

/** Directory entries as candidate strings, directories marked with a trailing slash — matches every shell's own tab-completion convention. */
export function formatPathCandidates(entries: DirEntryLike[]): string[] {
  return entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name));
}

/** Longest prefix shared by every candidate, compared case-insensitively but returned with the first candidate's own casing. Empty input returns ''. */
export function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    while (prefix.length > 0 && !s.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix === '') return '';
  }
  return prefix;
}

export interface CompletionResult {
  /** All matches, for rendering a dropdown when there's more than one. */
  matches: string[];
  /** Characters to send to the pty right now — either the full remainder of a single unambiguous match, or the shared extra characters across matches (partial completion), matching real shell Tab behavior. */
  suffixToSend: string;
}

/** The single entry point TerminalArea calls on Tab: decides what to send to the pty now and what a dropdown should show. Candidates are assumed pre-fetched — this function does no IO. */
export function computeCompletion(candidates: string[], partial: string): CompletionResult {
  const matches = matchByPrefix(candidates, partial);
  if (matches.length === 0) return { matches, suffixToSend: '' };
  if (matches.length === 1) return { matches, suffixToSend: matches[0].slice(partial.length) };

  const commonPrefix = longestCommonPrefix(matches);
  const suffixToSend = commonPrefix.length > partial.length ? commonPrefix.slice(partial.length) : '';
  return { matches, suffixToSend };
}
