import type { DetectedTask, TaskDetector } from './types';
import type { ProblemMatcherKind } from '../problemMatcher';

/** A script that invokes tsc/eslint directly gets that matcher for free — the script name alone is too generic to go on. Anything else is left unmatched rather than guessed at. */
function guessProblemMatcher(command: string): ProblemMatcherKind | undefined {
  if (/\btsc\b/.test(command)) return 'tsc';
  if (/\beslint\b/.test(command)) return 'eslint';
  return undefined;
}

/** Pure parse: package.json content in, one task per `scripts` entry out. No IO — the caller owns reading the file. */
export function parseNpmScripts(packageJsonContent: string): DetectedTask[] {
  let pkg: unknown;
  try {
    pkg = JSON.parse(packageJsonContent);
  } catch {
    return [];
  }
  if (typeof pkg !== 'object' || pkg === null) return [];
  const scripts = (pkg as { scripts?: unknown }).scripts;
  if (typeof scripts !== 'object' || scripts === null) return [];

  return Object.entries(scripts as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, command]) => {
      const matcher = guessProblemMatcher(command);
      return {
        id: name,
        name: `npm: ${name}`,
        command: `npm run ${name}`,
        ...(matcher ? { problemMatcher: matcher } : {}),
      };
    });
}

export const npmDetector: TaskDetector = {
  id: 'npm',
  markerFile: 'package.json',
  parse: parseNpmScripts,
};
