import { spawn, type ChildProcess } from 'child_process';
import type { NotebookKernelStatus } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { PYTHON_KERNEL_WRAPPER_SCRIPT, CELL_END_MARKER } from './pythonKernelWrapper';

export interface NotebookKernelSink {
  onStream(executionId: string, name: 'stdout' | 'stderr', text: string): void;
  onDone(executionId: string, status: 'ok' | 'error', error: string | null): void;
  onStatus(status: NotebookKernelStatus): void;
}

/** One launcher per supported kernel language — only Python for this MVP (same "Python is the reference language" scope every other language-specific feature in this app has started with: the LSP client, the DAP debugger). Adding a language later means writing that language's own wrapper script with the identical stdin/stdout protocol, then adding an entry here. */
const LANGUAGE_LAUNCHERS: Record<string, (interpreterPath?: string) => { command: string; args: string[] }> = {
  python: (interpreterPath) => ({ command: interpreterPath || 'python', args: ['-u', '-c', PYTHON_KERNEL_WRAPPER_SCRIPT] }),
};

interface KernelEntry {
  process: ChildProcess;
  language: string;
  sink: NotebookKernelSink;
  buffer: string;
  currentExecutionId: string | null;
}

export interface INotebookKernelService {
  startKernel(language: string, workspacePath: string, sink: NotebookKernelSink, interpreterPath?: string): string;
  executeCell(kernelId: string, code: string): string;
  interruptKernel(kernelId: string): void;
  restartKernel(kernelId: string, language: string, workspacePath: string, interpreterPath?: string): void;
  stopKernel(kernelId: string): void;
  /** Kills every live kernel process — call on app quit, same reasoning as McpService/ExternalAgentService's disposeAll(). */
  disposeAll(): void;
}

export const INotebookKernelService = createServiceIdentifier<INotebookKernelService>('notebookKernelService');

/**
 * Runs one persistent interpreter process per open notebook ("kernel"), instead of a real
 * Jupyter kernel (ZeroMQ, kernel connection files, execute_request/iopub messages). A full
 * Jupyter client is real, separate scope — this gets the property that actually matters for
 * a notebook (cell-to-cell state persists in one live process) via a tiny protocol this app
 * fully owns: see pythonKernelWrapper.ts for the exact stdin/stdout framing. The tradeoff is
 * real: no rich outputs (images/HTML/widgets), no multi-language kernels beyond what's
 * implemented here, no talking to an existing Jupyter server. What it does give: real
 * persistent variable state, live-streamed output, restart/interrupt — the actual notebook
 * experience — for meaningfully less implementation surface.
 */
export class NotebookKernelService implements INotebookKernelService {
  static readonly inject = [ILogService] as const;
  private kernels = new Map<string, KernelEntry>();

  constructor(private readonly logService: ILogService) {}

  startKernel(language: string, workspacePath: string, sink: NotebookKernelSink, interpreterPath?: string): string {
    const launcher = LANGUAGE_LAUNCHERS[language];
    if (!launcher) {
      throw new Error(`No notebook kernel available for language "${language}".`);
    }
    const kernelId = `kernel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.spawnProcess(kernelId, language, workspacePath, sink, interpreterPath);
    return kernelId;
  }

  executeCell(kernelId: string, code: string): string {
    const entry = this.kernels.get(kernelId);
    if (!entry) throw new Error(`Kernel "${kernelId}" is not running.`);
    if (entry.currentExecutionId) throw new Error('Kernel is still running a previous cell.');

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    entry.currentExecutionId = executionId;
    entry.sink.onStatus('busy');

    const payload = code.endsWith('\n') ? code : `${code}\n`;
    entry.process.stdin?.write(`${payload}${CELL_END_MARKER}\n`);
    return executionId;
  }

  interruptKernel(kernelId: string): void {
    const entry = this.kernels.get(kernelId);
    if (!entry) return;
    // Best-effort: delivers a real, catchable SIGINT on macOS/Linux (Python's default handler
    // raises KeyboardInterrupt inside whatever the cell is doing, caught by the wrapper's
    // `except BaseException` and reported as a normal error result). Node cannot deliver a
    // catchable SIGINT to a child on Windows — .kill('SIGINT') there just force-terminates
    // the process, so an interrupt on Windows behaves like a restart instead.
    entry.process.kill('SIGINT');
  }

  restartKernel(kernelId: string, language: string, workspacePath: string, interpreterPath?: string): void {
    const entry = this.kernels.get(kernelId);
    if (!entry) return;
    const sink = entry.sink;
    entry.process.removeAllListeners();
    entry.process.kill();
    this.kernels.delete(kernelId);
    this.spawnProcess(kernelId, language, workspacePath, sink, interpreterPath);
  }

  stopKernel(kernelId: string): void {
    const entry = this.kernels.get(kernelId);
    if (!entry) return;
    entry.process.removeAllListeners();
    entry.process.kill();
    this.kernels.delete(kernelId);
  }

  disposeAll(): void {
    for (const entry of this.kernels.values()) {
      entry.process.removeAllListeners();
      entry.process.kill();
    }
    this.kernels.clear();
  }

  private spawnProcess(kernelId: string, language: string, workspacePath: string, sink: NotebookKernelSink, interpreterPath?: string): void {
    // No synchronous 'starting' emission here on purpose: a caller building its sink from
    // startKernel()'s own return value (see host/ipc.ts) can't reference that value until
    // startKernel() has returned, so a status pushed before then would close over an
    // as-yet-unassigned kernelId. The renderer sets its own 'starting' state immediately
    // after calling startKernel(), before awaiting the result — the same information,
    // available earlier, with no such ordering hazard.
    const launcher = LANGUAGE_LAUNCHERS[language];
    const { command, args } = launcher(interpreterPath);
    const child = spawn(command, args, { cwd: workspacePath, env: process.env });
    const entry: KernelEntry = { process: child, language, sink, buffer: '', currentExecutionId: null };
    this.kernels.set(kernelId, entry);

    child.stdout?.on('data', (chunk: Buffer) => this.handleStdout(kernelId, chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.logService.warn(`Notebook kernel "${kernelId}" stderr:`, chunk.toString()));
    child.on('error', (err) => {
      this.logService.error(`Notebook kernel "${kernelId}" process error:`, err);
      sink.onStatus('dead');
      this.kernels.delete(kernelId);
    });
    child.on('exit', () => {
      if (this.kernels.get(kernelId) === entry) {
        sink.onStatus('dead');
        this.kernels.delete(kernelId);
      }
    });
  }

  private handleStdout(kernelId: string, chunk: Buffer): void {
    const entry = this.kernels.get(kernelId);
    if (!entry) return;
    entry.buffer += chunk.toString('utf8');
    const lines = entry.buffer.split('\n');
    entry.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: any;
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue; // Not a protocol line — the wrapper owns stdout exclusively, but stay defensive.
      }

      if (message.type === 'ready') {
        entry.sink.onStatus('idle');
      } else if (message.type === 'stream') {
        if (entry.currentExecutionId) entry.sink.onStream(entry.currentExecutionId, message.name, message.text);
      } else if (message.type === 'done') {
        if (entry.currentExecutionId) {
          entry.sink.onDone(entry.currentExecutionId, message.status, message.error ?? null);
          entry.currentExecutionId = null;
        }
        entry.sink.onStatus('idle');
      }
    }
  }
}
