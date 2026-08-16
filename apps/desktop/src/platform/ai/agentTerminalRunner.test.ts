import { describe, expect, it } from 'vitest';
import os from 'os';
import { runAgentCommand } from './agentTerminalRunner';

// Real child_process.exec calls throughout (no mocking) — matching this
// codebase's convention of testing process/fs/git integrations against the
// real thing rather than a fake. `node -e "..."` is used as the command
// under test since it's guaranteed present and behaves identically on every
// platform this repo runs on, unlike shell builtins (`echo`, `sleep`).

describe('runAgentCommand', () => {
  it('runs a real command and captures stdout with exit code 0', async () => {
    const result = await runAgentCommand('node -e "console.log(\'hello from agent\')"', os.tmpdir(), new AbortController().signal);

    expect(result.stdout.trim()).toBe('hello from agent');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr and a non-zero exit code for a failing command, without throwing', async () => {
    const result = await runAgentCommand(
      'node -e "console.error(\'boom\'); process.exit(3)"',
      os.tmpdir(),
      new AbortController().signal,
    );

    expect(result.stderr).toContain('boom');
    expect(result.exitCode).toBe(3);
  });

  it('rejects with an AbortError when the signal fires mid-command, instead of resolving', async () => {
    const controller = new AbortController();
    const promise = runAgentCommand('node -e "setTimeout(() => {}, 30000)"', os.tmpdir(), controller.signal);

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
