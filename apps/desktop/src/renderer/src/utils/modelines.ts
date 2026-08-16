/**
 * Modelines — per-file editor-settings overrides declared as a comment inside the file
 * itself, following the two conventions already in wide real-world use (Vim's `vim:`
 * and Emacs's `-*- ... -*-`), so files edited across multiple editors/IDEs keep working
 * the same way here. Only the first/last few lines are scanned, matching every real
 * implementation of this feature (checking the whole file would be wasteful and would
 * risk false-positives from unrelated text matching the pattern).
 */

export interface ModelineOverrides {
  tabSize?: number;
  insertSpaces?: boolean;
  wordWrap?: 'on' | 'off';
}

const LINES_TO_SCAN = 5;

function candidateLines(content: string): string[] {
  const lines = content.split(/\r\n|\n/);
  if (lines.length <= LINES_TO_SCAN * 2) return lines;
  return [...lines.slice(0, LINES_TO_SCAN), ...lines.slice(lines.length - LINES_TO_SCAN)];
}

/** Vim: `// vim: ts=4 sw=4 et`, `/* vim: set ts=4 sw=4 et: *\/`, `# vim:ts=4:sw=4:et` */
function parseVimModeline(line: string): ModelineOverrides | null {
  const marker = line.search(/\bvim:\s*/i);
  if (marker === -1) return null;
  let rest = line.slice(marker).replace(/^vim:\s*/i, '');
  rest = rest.replace(/^set\s+/i, '');
  rest = rest.replace(/\*\/\s*$/, ''); // trailing block-comment closer, e.g. "et: */"
  rest = rest.replace(/:\s*$/, '');
  const tokens = rest.trim().split(/[\s:]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const overrides: ModelineOverrides = {};
  for (const tok of tokens) {
    const [key, value] = tok.split('=');
    switch (key) {
      case 'ts':
      case 'tabstop':
        if (value && /^\d+$/.test(value)) overrides.tabSize = parseInt(value, 10);
        break;
      case 'sw':
      case 'shiftwidth':
        if (value && /^\d+$/.test(value) && overrides.tabSize === undefined) overrides.tabSize = parseInt(value, 10);
        break;
      case 'et':
      case 'expandtab':
        overrides.insertSpaces = true;
        break;
      case 'noet':
      case 'noexpandtab':
        overrides.insertSpaces = false;
        break;
      case 'wrap':
        overrides.wordWrap = 'on';
        break;
      case 'nowrap':
        overrides.wordWrap = 'off';
        break;
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : null;
}

/** Emacs: `// -*- tab-width: 4; indent-tabs-mode: nil; -*-` */
function parseEmacsModeline(line: string): ModelineOverrides | null {
  const m = line.match(/-\*-\s*(.+?)\s*-\*-/);
  if (!m) return null;

  const overrides: ModelineOverrides = {};
  const tabWidth = m[1].match(/tab-width:\s*(\d+)/);
  if (tabWidth) overrides.tabSize = parseInt(tabWidth[1], 10);
  const indentTabsMode = m[1].match(/indent-tabs-mode:\s*(nil|t)\b/);
  if (indentTabsMode) overrides.insertSpaces = indentTabsMode[1] === 'nil';
  return Object.keys(overrides).length > 0 ? overrides : null;
}

/** Returns the first recognized modeline's overrides, or `{}` if none found. */
export function parseModelines(content: string): ModelineOverrides {
  for (const line of candidateLines(content)) {
    const overrides = parseVimModeline(line) ?? parseEmacsModeline(line);
    if (overrides) return overrides;
  }
  return {};
}
