import { spawn, type ChildProcess } from 'child_process';
import type { ExternalAgentConfig } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { IDatabaseService } from '../db';

const EXTERNAL_AGENTS_SETTING_KEY = 'external-agents';
const PROMPT_TOKEN = '{prompt}';

export interface ExternalAgentRunSink {
  onChunk(text: string): void;
  onDone(exitCode: number | null): void;
  onError(message: string): void;
}

interface ActiveRun {
  child: ChildProcess;
}

export interface IExternalAgentService {
  getConfigs(): ExternalAgentConfig[];
  saveConfig(config: ExternalAgentConfig): Promise<boolean>;
  deleteConfig(id: string): Promise<boolean>;
  /** Throws synchronously if configId doesn't exist — the IPC handler lets that reject the invoke() promise directly, since (unlike a spawn failure) it's known before any process exists to report through the sink. */
  run(configId: string, prompt: string, workspacePath: string, sink: ExternalAgentRunSink): string;
  cancel(runId: string): void;
  /** Kills every in-flight run's process — call on app quit, same reasoning as McpService.disposeAll(). */
  disposeAll(): void;
}

export const IExternalAgentService = createServiceIdentifier<IExternalAgentService>('externalAgentService');

/**
 * Runs a configured external CLI agent (Aider, the Claude Code CLI, a custom script, ...) as a
 * fully autonomous child process and streams its raw stdout/stderr back read-only — no JSON-RPC
 * framing, no tool-call parsing, since the external tool owns its own reasoning and file edits
 * entirely. Spawned with an argv array (never `shell: true`), so the user's prompt can never be
 * interpreted as shell syntax no matter what it contains.
 */
export class ExternalAgentService implements IExternalAgentService {
  static readonly inject = [ILogService, IDatabaseService] as const;
  private configs = new Map<string, ExternalAgentConfig>();
  private runs = new Map<string, ActiveRun>();
  private loaded = false;

  constructor(
    private readonly logService: ILogService,
    private readonly databaseService: IDatabaseService,
  ) {}

  getConfigs(): ExternalAgentConfig[] {
    this.ensureLoaded();
    return Array.from(this.configs.values());
  }

  async saveConfig(config: ExternalAgentConfig): Promise<boolean> {
    this.ensureLoaded();
    this.configs.set(config.id, config);
    this.persist();
    return true;
  }

  async deleteConfig(id: string): Promise<boolean> {
    this.ensureLoaded();
    this.configs.delete(id);
    this.persist();
    return true;
  }

  run(configId: string, prompt: string, workspacePath: string, sink: ExternalAgentRunSink): string {
    this.ensureLoaded();
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error(`External agent "${configId}" is not configured.`);
    }

    const runId = `extagent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hasPromptToken = config.args.includes(PROMPT_TOKEN);
    const args = config.args.map((a) => (a === PROMPT_TOKEN ? prompt : a));

    let child: ChildProcess;
    try {
      child = spawn(config.command, args, { cwd: workspacePath, env: process.env });
    } catch (err: any) {
      throw new Error(`Failed to start "${config.name}": ${err?.message || err}`);
    }
    this.runs.set(runId, { child });

    if (!hasPromptToken) {
      child.stdin?.end(prompt);
    } else {
      child.stdin?.end();
    }

    child.stdout?.on('data', (chunk: Buffer) => sink.onChunk(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => sink.onChunk(chunk.toString('utf8')));
    child.on('error', (err) => {
      this.logService.error(`External agent "${config.name}" process error:`, err);
      this.runs.delete(runId);
      sink.onError(err.message);
    });
    child.on('exit', (code) => {
      this.runs.delete(runId);
      sink.onDone(code);
    });

    return runId;
  }

  cancel(runId: string): void {
    const entry = this.runs.get(runId);
    if (!entry) return;
    entry.child.kill();
    this.runs.delete(runId);
  }

  disposeAll(): void {
    for (const entry of this.runs.values()) {
      entry.child.kill();
    }
    this.runs.clear();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.databaseService.getSettings()[EXTERNAL_AGENTS_SETTING_KEY];
      const parsed: ExternalAgentConfig[] = raw ? JSON.parse(raw) : [];
      for (const config of parsed) this.configs.set(config.id, config);
    } catch (err) {
      this.logService.error('Failed to parse stored external agent configs:', err);
    }
  }

  private persist(): void {
    this.databaseService.setSetting(EXTERNAL_AGENTS_SETTING_KEY, JSON.stringify(Array.from(this.configs.values())));
  }
}
