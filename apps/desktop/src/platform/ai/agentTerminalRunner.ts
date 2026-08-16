import { exec } from 'child_process';

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  /** null when the process was killed (timeout) rather than exiting normally. */
  exitCode: number | null;
}

const MAX_OUTPUT_CHARS = 20_000;
const COMMAND_TIMEOUT_MS = 60_000;

/** One-shot shell execution for Agent Mode's run_terminal_command tool (not the interactive PTY session); the approval gate upstream is the safety mechanism, not this function — aborts reject rather than resolve, reusing the standard isAbortError() path. */
export function runAgentCommand(command: string, cwd: string, signal: AbortSignal): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { cwd, signal, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && error.name === 'AbortError') {
          reject(error);
          return;
        }

        const truncate = (text: string) => (text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n... (truncated)` : text);

        resolve({
          stdout: truncate(stdout.toString()),
          stderr: truncate(stderr.toString()),
          exitCode: error ? (error.code ?? null) : 0,
        });
      },
    );
  });
}
