import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExternalAgentService } from './externalAgentService';
import { DatabaseService } from '../db';
import { FakeLogService } from '../log';

// Real subprocesses (tiny Node scripts), no mocking — same convention as mcpService.test.ts
// and gitService.test.ts.
const ECHO_ARGS_SCRIPT = `process.stdout.write(process.argv.slice(2).join(' '));`;
const ECHO_STDIN_SCRIPT = `
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { data += chunk; });
process.stdin.on('end', () => { process.stdout.write('stdin said: ' + data); });
`;
const EXIT_WITH_CODE_SCRIPT = `process.stdout.write('about to exit'); process.exit(7);`;
const SLEEP_FOREVER_SCRIPT = `process.stdout.write('started'); setInterval(() => {}, 1000);`;

/** A real sink whose onDone/onError resolve a promise the test can await, rather than polling. */
function makeSink() {
  const chunks: string[] = [];
  const result: { doneExitCode?: number | null; errorMessage?: string } = {};
  let resolveDone: () => void = () => {};
  const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
  const sink = {
    onChunk: (text: string) => chunks.push(text),
    onDone: (exitCode: number | null) => { result.doneExitCode = exitCode; resolveDone(); },
    onError: (message: string) => { result.errorMessage = message; resolveDone(); },
  };
  return { chunks, result, sink, waitForDone: () => donePromise };
}

describe('ExternalAgentService (real subprocesses, no mocking)', () => {
  let tmpDir: string;
  let databaseService: DatabaseService;
  let service: ExternalAgentService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-extagent-test-'));
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    service = new ExternalAgentService(new FakeLogService(), databaseService);
  });

  afterEach(() => {
    service.disposeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  });

  const writeScript = (name: string, content: string) => {
    const scriptPath = path.join(tmpDir, name);
    fs.writeFileSync(scriptPath, content);
    return scriptPath;
  };

  describe('config CRUD', () => {
    it('saveConfig persists a config, retrievable via getConfigs', async () => {
      await service.saveConfig({ id: 'a1', name: 'Aider', command: 'aider', args: ['--yes', '--message', '{prompt}'] });
      expect(service.getConfigs()).toEqual([{ id: 'a1', name: 'Aider', command: 'aider', args: ['--yes', '--message', '{prompt}'] }]);
    });

    it('saving a config with an existing id upserts rather than duplicating', async () => {
      await service.saveConfig({ id: 'a1', name: 'Aider', command: 'aider', args: [] });
      await service.saveConfig({ id: 'a1', name: 'Aider (renamed)', command: 'aider', args: ['--yes'] });
      expect(service.getConfigs()).toEqual([{ id: 'a1', name: 'Aider (renamed)', command: 'aider', args: ['--yes'] }]);
    });

    it('deleteConfig removes a config', async () => {
      await service.saveConfig({ id: 'a1', name: 'Aider', command: 'aider', args: [] });
      await service.deleteConfig('a1');
      expect(service.getConfigs()).toEqual([]);
    });

    it('configs persist across a fresh service instance reading the same database (real settings round-trip)', async () => {
      await service.saveConfig({ id: 'a1', name: 'Aider', command: 'aider', args: ['--yes'] });
      const secondService = new ExternalAgentService(new FakeLogService(), databaseService);
      expect(secondService.getConfigs()).toEqual([{ id: 'a1', name: 'Aider', command: 'aider', args: ['--yes'] }]);
    });
  });

  describe('run()', () => {
    it('substitutes {prompt} into args as a single argv entry and streams real stdout back', async () => {
      const scriptPath = writeScript('echo-args.js', ECHO_ARGS_SCRIPT);
      await service.saveConfig({ id: 'a1', name: 'EchoArgs', command: process.execPath, args: [scriptPath, '--message', '{prompt}'] });

      const { chunks, result, sink, waitForDone } = makeSink();
      service.run('a1', 'fix the bug; rm -rf /', tmpDir, sink);
      await waitForDone();

      // A prompt containing shell metacharacters arrives completely intact as ONE argument — proof spawn() never went through a shell.
      expect(chunks.join('')).toBe('--message fix the bug; rm -rf /');
      expect(result.doneExitCode).toBe(0);
    }, 10000);

    it('pipes the prompt to stdin when no arg contains the {prompt} token', async () => {
      const scriptPath = writeScript('echo-stdin.js', ECHO_STDIN_SCRIPT);
      await service.saveConfig({ id: 'a1', name: 'EchoStdin', command: process.execPath, args: [scriptPath] });

      const { chunks, result, sink, waitForDone } = makeSink();
      service.run('a1', 'hello via stdin', tmpDir, sink);
      await waitForDone();

      expect(chunks.join('')).toBe('stdin said: hello via stdin');
      expect(result.doneExitCode).toBe(0);
    }, 10000);

    it('reports the real non-zero exit code via onDone', async () => {
      const scriptPath = writeScript('exit-code.js', EXIT_WITH_CODE_SCRIPT);
      await service.saveConfig({ id: 'a1', name: 'ExitCode', command: process.execPath, args: [scriptPath] });

      const { chunks, result, sink, waitForDone } = makeSink();
      service.run('a1', 'irrelevant', tmpDir, sink);
      await waitForDone();

      expect(chunks.join('')).toBe('about to exit');
      expect(result.doneExitCode).toBe(7);
    }, 10000);

    it('throws synchronously for an unconfigured agent id', () => {
      const { sink } = makeSink();
      expect(() => service.run('nonexistent', 'x', tmpDir, sink)).toThrow(/not configured/);
    });

    it('cancel() kills the process before it would otherwise finish', async () => {
      const scriptPath = writeScript('sleep-forever.js', SLEEP_FOREVER_SCRIPT);
      await service.saveConfig({ id: 'a1', name: 'Sleeper', command: process.execPath, args: [scriptPath] });

      const { chunks, result, sink, waitForDone } = makeSink();
      const runId = service.run('a1', 'irrelevant', tmpDir, sink);

      // Wait until the process has actually started (its first stdout chunk) before cancelling, so this proves a live process was killed, not a race against spawn().
      await vi.waitFor(() => expect(chunks.join('')).toBe('started'));

      service.cancel(runId);
      await waitForDone();

      // Killed processes report a null exit code (terminated by signal), not a normal 0.
      expect(result.doneExitCode).not.toBe(0);
    }, 10000);
  });
});
