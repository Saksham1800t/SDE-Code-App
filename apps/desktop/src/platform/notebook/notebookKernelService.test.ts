import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NotebookKernelService } from './notebookKernelService';
import { FakeLogService } from '../log';
import type { NotebookKernelStatus } from '@sde-code/protocol';

/** A real sink recording every event, with a promise-per-milestone so tests can await
 * "ready" or "this execution finished" instead of polling — same convention as
 * externalAgentService.test.ts's makeSink. */
function makeSink() {
  const statuses: NotebookKernelStatus[] = [];
  const streams: Array<{ executionId: string; name: 'stdout' | 'stderr'; text: string }> = [];
  const dones: Array<{ executionId: string; status: 'ok' | 'error'; error: string | null }> = [];
  let resolveReady: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
  let resolveDone: (() => void) | null = null;
  let donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });

  const sink = {
    onStream: (executionId: string, name: 'stdout' | 'stderr', text: string) => {
      streams.push({ executionId, name, text });
    },
    onDone: (executionId: string, status: 'ok' | 'error', error: string | null) => {
      dones.push({ executionId, status, error });
      resolveDone?.();
    },
    onStatus: (status: NotebookKernelStatus) => {
      statuses.push(status);
      if (status === 'idle' && statuses.filter((s) => s === 'idle').length === 1) resolveReady();
    },
  };

  return {
    sink,
    statuses,
    streams,
    dones,
    waitForReady: () => readyPromise,
    /** Call right before executeCell so the promise it returns corresponds to THIS execution's done event. */
    armDonePromise: () => { donePromise = new Promise<void>((resolve) => { resolveDone = resolve; }); return donePromise; },
  };
}

describe('NotebookKernelService (real python subprocess, no mocking)', () => {
  let tmpDir: string;
  let service: NotebookKernelService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-notebook-test-'));
    service = new NotebookKernelService(new FakeLogService());
  });

  afterEach(() => {
    service.disposeAll();
    // Same non-fatal cleanup-noise handling as gitService.test.ts: a just-killed subprocess
    // can leave Windows still holding a handle on tmpDir (its cwd) for a moment after exit.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (err) {
      console.warn(`Failed to clean up test tmpDir ${tmpDir} (non-fatal):`, err);
    }
  });

  it('starts a real kernel and reports idle once ready', async () => {
    // No 'starting' status comes from the service itself — see spawnProcess's comment.
    // The renderer sets that state locally, immediately after calling startKernel().
    const { sink, statuses, waitForReady } = makeSink();
    service.startKernel('python', tmpDir, sink);
    await waitForReady();
    expect(statuses).toContain('idle');
  }, 15000);

  it('executes a simple cell and reports done with status ok', async () => {
    const { sink, dones, waitForReady, armDonePromise } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    const donePromise = armDonePromise();
    const executionId = service.executeCell(kernelId, 'x = 1 + 1');
    await donePromise;

    expect(dones).toEqual([{ executionId, status: 'ok', error: null }]);
  }, 15000);

  it('streams real print() output live, tagged with the executing cell\'s id', async () => {
    const { sink, streams, waitForReady, armDonePromise } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    const donePromise = armDonePromise();
    const executionId = service.executeCell(kernelId, 'print("hello")\nprint("world")');
    await donePromise;

    // CPython's print() issues its content and trailing newline as separate write() calls,
    // so this can legitimately arrive as more than one stream message — concatenate before
    // asserting, which is also exactly what the real UI does when appending cell output.
    expect(streams.every((s) => s.executionId === executionId && s.name === 'stdout')).toBe(true);
    expect(streams.map((s) => s.text).join('')).toBe('hello\nworld\n');
  }, 15000);

  it('preserves variable state across cells — the entire point of a persistent kernel', async () => {
    const { sink, streams, waitForReady, armDonePromise } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    let donePromise = armDonePromise();
    service.executeCell(kernelId, 'favorite_number = 42');
    await donePromise;

    donePromise = armDonePromise();
    const executionId2 = service.executeCell(kernelId, 'print(favorite_number * 2)');
    await donePromise;

    expect(streams.every((s) => s.executionId === executionId2 && s.name === 'stdout')).toBe(true);
    expect(streams.map((s) => s.text).join('')).toBe('84\n');
  }, 15000);

  it('reports a real exception as a done status of "error" with a real traceback', async () => {
    const { sink, dones, waitForReady, armDonePromise } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    const donePromise = armDonePromise();
    service.executeCell(kernelId, 'raise ValueError("boom")');
    await donePromise;

    expect(dones).toHaveLength(1);
    expect(dones[0].status).toBe('error');
    expect(dones[0].error).toContain('ValueError: boom');
  }, 15000);

  it('a cell that errors does not corrupt kernel state — the next cell still runs against the same namespace', async () => {
    const { sink, streams, waitForReady, armDonePromise } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    let donePromise = armDonePromise();
    service.executeCell(kernelId, 'y = 10');
    await donePromise;

    donePromise = armDonePromise();
    service.executeCell(kernelId, 'raise RuntimeError("oops")');
    await donePromise;

    donePromise = armDonePromise();
    const executionId3 = service.executeCell(kernelId, 'print(y)');
    await donePromise;

    expect(streams.every((s) => s.executionId === executionId3 && s.name === 'stdout')).toBe(true);
    expect(streams.map((s) => s.text).join('')).toBe('10\n');
  }, 15000);

  it('throws when a cell is submitted while the kernel is still busy', async () => {
    const { sink, waitForReady } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    service.executeCell(kernelId, 'import time; time.sleep(0.3)');
    expect(() => service.executeCell(kernelId, 'x = 1')).toThrow(/still running/i);
  }, 15000);

  it('throws synchronously for an unsupported language', () => {
    const { sink } = makeSink();
    expect(() => service.startKernel('cobol', tmpDir, sink)).toThrow(/no notebook kernel/i);
  });

  it('restartKernel discards prior cell state (fresh global namespace)', async () => {
    const { sink, dones, waitForReady, armDonePromise } = makeSink();
    const kernelId = service.startKernel('python', tmpDir, sink);
    await waitForReady();

    let donePromise = armDonePromise();
    service.executeCell(kernelId, 'z = 99');
    await donePromise;

    service.restartKernel(kernelId, 'python', tmpDir);
    await waitForReady().catch(() => {}); // already resolved from first ready; just give the respawn a moment
    await new Promise((r) => setTimeout(r, 800));

    donePromise = armDonePromise();
    service.executeCell(kernelId, 'print(z)');
    await donePromise;

    expect(dones[dones.length - 1].status).toBe('error');
    expect(dones[dones.length - 1].error).toContain('NameError');
  }, 15000);
});
