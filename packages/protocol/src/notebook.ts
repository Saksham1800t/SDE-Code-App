/**
 * REPL / notebook cells — a persistent per-language interpreter process ("kernel") that
 * survives across multiple cell executions, giving cells a shared, live variable namespace
 * the way a real notebook works. Deliberately NOT a full Jupyter kernel-protocol (ZeroMQ)
 * client — see notebookKernelService.ts's doc comment for the lightweight stdin/stdout
 * protocol used instead, which the roadmap itself allows ("simpler per-language REPL
 * piping" as an alternative to the full kernel-message protocol).
 */

/** 'starting' is set by the renderer itself right after calling startKernel(), before the process is even up — the main-process kernel service never emits it (see notebookKernelService.ts's spawnProcess comment for why). The other three states arrive via the notebook:kernelStatus push channel. */
export type NotebookKernelStatus = 'starting' | 'idle' | 'busy' | 'dead';

export interface NotebookKernelStartResult {
  kernelId: string;
}

export interface NotebookCellExecuteResult {
  /** Scopes the streamed output/done events below to this specific execution, not just the kernel — a kernel can only run one cell at a time, but the renderer still needs to tell "this cell's output" apart if a stale listener lingers. */
  executionId: string;
}

/** Only kernel lifecycle + cell-submission are invoke/handle-shaped; a cell's actual output arrives via the notebook:cellOutput/notebook:cellDone/notebook:kernelStatus push channels, same reasoning as ai.ts's AgentIpcContract note. */
export type NotebookIpcContract = {
  /** interpreterPath lets the caller honor a per-project Toolchain selection (store/toolchain.ts) instead of whatever "python" resolves to on PATH. */
  'notebook:startKernel': (language: string, workspacePath: string, interpreterPath?: string) => Promise<NotebookKernelStartResult>;
  'notebook:executeCell': (kernelId: string, code: string) => Promise<NotebookCellExecuteResult>;
  /** Best-effort — sends SIGINT to the kernel process. Reliable on macOS/Linux; on Windows, Node cannot deliver a catchable SIGINT to a child process, so this behaves like a forceful stop there instead (documented in notebookKernelService.ts). */
  'notebook:interruptKernel': (kernelId: string) => Promise<void>;
  /** Kills and respawns the kernel process, discarding all cell-to-cell state (a fresh global namespace) — the notebook equivalent of "Restart Kernel". */
  'notebook:restartKernel': (kernelId: string, language: string, workspacePath: string, interpreterPath?: string) => Promise<void>;
  'notebook:stopKernel': (kernelId: string) => Promise<void>;
};
