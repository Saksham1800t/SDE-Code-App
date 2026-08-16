import type { ProblemMatcherKind } from '../problemMatcher';

/** What a detector's pure parse function returns per script found — deliberately missing `id`'s detector-prefix and `source`, which the loader applies uniformly across every detector's output. */
export interface DetectedTask {
  /** Unprefixed — e.g. the npm script name ('dev', 'build'). */
  id: string;
  name: string;
  command: string;
  /** Relative to the owning workspace folder; omitted runs at that folder's root. */
  cwd?: string;
  problemMatcher?: ProblemMatcherKind;
}

/** One project-script source (npm today; more can be added later). Detectors are pure and IO-free (marker file content in, tasks out), so each is unit-testable with no Electron/IPC mocking. */
export interface TaskDetector {
  /** Also becomes the `${id}:` prefix on every task this detector produces and the TaskDefinition.source value TaskPickerDialog uses for its badge. */
  id: string;
  /** Filename relative to the workspace folder root that signals this detector applies (e.g. 'package.json'). A missing/unreadable file just means no contribution, not an error. */
  markerFile: string;
  /** No IO — parses already-read content into zero or more tasks. Return [] on anything unparseable rather than throwing, so one malformed file can't take down other detectors. */
  parse: (markerFileContent: string) => DetectedTask[];
}
