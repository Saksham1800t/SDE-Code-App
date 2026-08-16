import type { ProblemEntry } from '../store/problems';

export type ProblemMatcherKind = 'tsc' | 'eslint' | 'none';

/** node-pty forces FORCE_COLOR=1, so tsc/eslint output carries ANSI codes that break the regexes below. Strips every CSI escape sequence, not just SGR/color (`...m`) — an SGR-only regex let cursor-visibility codes like `[?25h` leak into matched file paths. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

function toAbsolute(rawPath: string, cwd: string): string {
  const normalized = rawPath.replace(/\\/g, '/');
  // Already absolute (POSIX '/...' or Windows 'C:/...').
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return normalized;
  const base = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  return `${base}/${normalized}`;
}

// tsc's default (non---pretty) diagnostic format:
//   src/foo.ts(12,5): error TS2345: Argument of type 'x' is not assignable...
const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+:\s+.*)$/;

// eslint's "stylish" formatter prints the file path once, then indented diagnostic rows with no per-row path, so the matcher tracks "current file" across lines.
const ESLINT_FILE_LINE = /^(?:[A-Za-z]:)?[\\/][^:]+\.[a-zA-Z]+$/;
const ESLINT_DIAGNOSTIC_LINE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/;

/** Pure, stateful-per-call line matcher — call with the full accumulated output lines for one task run, not incrementally per-chunk. Returns every match found, in order. */
export function matchProblemLines(lines: string[], matcher: ProblemMatcherKind, cwd: string): ProblemEntry[] {
  if (matcher === 'none') return [];

  const entries: ProblemEntry[] = [];
  const clean = lines.map(stripAnsi);

  if (matcher === 'tsc') {
    for (const line of clean) {
      const m = TSC_LINE.exec(line.trim());
      if (!m) continue;
      const [, rawPath, lineStr, colStr, severity, message] = m;
      const filePath = toAbsolute(rawPath, cwd);
      const lineNum = Number(lineStr);
      const col = Number(colStr);
      entries.push({
        filePath,
        fileName: filePath.split('/').pop() || filePath,
        line: lineNum,
        column: col,
        endLine: lineNum,
        endColumn: col + 1,
        message,
        severity: severity as 'error' | 'warning',
        source: 'tsc',
      });
    }
    return entries;
  }

  // eslint
  let currentFile: string | null = null;
  for (const rawLine of clean) {
    const trimmed = rawLine.trimEnd();
    if (trimmed.trim().length === 0) continue;
    if (ESLINT_FILE_LINE.test(trimmed.trim())) {
      currentFile = toAbsolute(trimmed.trim(), cwd);
      continue;
    }
    const m = ESLINT_DIAGNOSTIC_LINE.exec(rawLine);
    if (m && currentFile) {
      const [, lineStr, colStr, severity, message, rule] = m;
      const lineNum = Number(lineStr);
      const col = Number(colStr);
      entries.push({
        filePath: currentFile,
        fileName: currentFile.split('/').pop() || currentFile,
        line: lineNum,
        column: col,
        endLine: lineNum,
        endColumn: col + 1,
        message: rule ? `${message} (${rule})` : message,
        severity: severity as 'error' | 'warning',
        source: 'eslint',
      });
    }
  }
  return entries;
}
