import fs from 'fs/promises';
import path from 'path';

// PATHEXT's real-world default on a machine that's never customized it —
// used as a fallback only; the env var itself is preferred when present.
const WINDOWS_DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

let cached: string[] | null = null;

async function scanDirForExecutables(dir: string, isWin: boolean, extensions: string[]): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // A PATH entry pointing at a missing/unreadable directory is common (stale env var, removed tool) — not worth surfacing.
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    if (isWin) {
      const ext = path.extname(entry.name).toUpperCase();
      if (extensions.includes(ext)) {
        names.push(entry.name.slice(0, entry.name.length - ext.length));
      }
      continue;
    }

    // POSIX: an explicit executable-bit check keeps stray non-executable data files out of the results.
    try {
      await fs.access(path.join(dir, entry.name), fs.constants.X_OK);
      names.push(entry.name);
    } catch {
      // Not executable — skip.
    }
  }
  return names;
}

/** Every executable name on PATH, scanned once and cached for the process lifetime; extension-stripped on Windows (`git.exe` -> `git`) to match what the user types. */
export async function getPathExecutables(): Promise<string[]> {
  if (cached) return cached;

  const isWin = process.platform === 'win32';
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const pathValue = process.env[pathKey] ?? '';
  const dirs = pathValue.split(path.delimiter).map((p) => p.trim()).filter(Boolean);
  const extensions = isWin
    ? (process.env.PATHEXT || WINDOWS_DEFAULT_PATHEXT).split(';').map((e) => e.trim().toUpperCase()).filter(Boolean)
    : [];

  const results = await Promise.all(dirs.map((dir) => scanDirForExecutables(dir, isWin, extensions)));
  cached = Array.from(new Set(results.flat())).sort((a, b) => a.localeCompare(b));
  return cached;
}
