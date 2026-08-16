/** Detects the project's real test-runner command from package.json's `scripts.test` rather than hardcoding vitest. Recognizes vitest/jest to scope to specific files; anything else falls back to running the full suite unmodified. */
export interface TestRunnerCommand {
  command: string;
  /** False when the command can only run the full suite, not just the suggested file(s) — surface this in the UI rather than implying a scoped run. */
  scopedToFile: boolean;
}

export async function detectTestRunnerCommand(workspacePath: string, testFilePaths: string[]): Promise<TestRunnerCommand | null> {
  const api = window.api;
  if (!api?.readFile || testFilePaths.length === 0) return null;

  let pkgRaw: string;
  try {
    pkgRaw = await api.readFile(`${workspacePath}/package.json`);
  } catch {
    return null;
  }

  let testScript: string | undefined;
  try {
    testScript = JSON.parse(pkgRaw)?.scripts?.test;
  } catch {
    return null;
  }
  if (!testScript) return null;

  const filesArg = testFilePaths.map((p) => `"${p}"`).join(' ');

  if (/\bvitest\b/.test(testScript)) {
    return { command: `npx vitest run ${filesArg}`, scopedToFile: true };
  }
  if (/\bjest\b/.test(testScript)) {
    return { command: `npx jest ${filesArg}`, scopedToFile: true };
  }

  return { command: testScript, scopedToFile: false };
}
