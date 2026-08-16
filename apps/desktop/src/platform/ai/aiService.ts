import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import type { AiQueryOptions, AgentFileChange, AiConnectionTestResult, AgentPolicyToolName, AgentToolPolicy } from '@sde-code/protocol';
import { DEFAULT_AGENT_TOOL_POLICIES } from '@sde-code/protocol';
import type { AITool } from '@sde-code/sdk';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { IDatabaseService } from '../db';
import { IFileSystemService } from '../fs';
import { ISearchService } from '../search';
import { IGitService } from '../git';
import { IImpactAnalysisService } from '../codeMap';
import { IDisposable } from '../../kernel';
import { createAgentTools, READ_ONLY_AGENT_TOOL_NAMES, applyAgentToolPolicies } from './agentTools';
import { createRepoTools } from './repoTools';
import { createImpactAnalysisTools } from '../codeMap/impactAnalysisTools';
import { runAgentCommand } from './agentTerminalRunner';
import { MAX_AGENT_ITERATIONS } from './agentTypes';
import type { AgentToolCallRequest, AgentQuerySink } from './agentTypes';
import type { IExtensionToolProvider, IExtensionContextProvider } from './extensibility';

/** Where a query's streamed output goes, decided by the caller — keeps AiService free of any Electron/BrowserWindow dependency; `host/ipc.ts` constructs the sink that forwards into `win.webContents.send(...)`. */
export interface AiQuerySink {
  onChunk(text: string): void;
  onError(message: string): void;
}

interface GenerationOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface InlineCompletionRequest {
  provider: string;
  model: string;
  prefix: string;
  suffix: string;
  language: string;
}

/** Each provider's agentQuery() branch builds one of these, owning that provider's native multi-turn conversation shape as closure state; sendTurn() streams prose and returns requested tool calls, appendToolResults() feeds results back in. */
interface AgentProviderAdapter {
  sendTurn(signal: AbortSignal, onChunk: (text: string) => void): Promise<AgentToolCallRequest[]>;
  appendToolResults(results: Array<{ toolCallId: string; toolName: string; content: string }>): void;
}

export interface IAiService extends IDisposable {
  query(provider: string, model: string, prompt: string, options: AiQueryOptions, sink: AiQuerySink): Promise<void>;
  agentQuery(provider: string, model: string, prompt: string, options: AiQueryOptions, sink: AgentQuerySink): Promise<void>;
  /** Resolves the pending run_terminal_command approval identified by requestId — a no-op if it's already gone (e.g. flushed by abort()). */
  resolvePendingApproval(requestId: string, approved: boolean): void;
  /** Cancels the in-flight query for this session only — other concurrent sessions (Parallel Agent Threads) are untouched. Omitting sessionId targets the same internal fallback id query()/agentQuery() use when the caller omits it, reproducing pre-multi-session behavior. */
  abort(sessionId?: string): void;
  completeInline(request: InlineCompletionRequest): Promise<string>;
  /** Fires one minimal request against `provider`'s currently-saved credentials and reports whether it succeeded. */
  testConnection(provider: string): Promise<AiConnectionTestResult>;
  /** Wired in by the host composition root once — see extensibility.ts for why this is a setter, not a constructor dependency. */
  setExtensionToolProvider(provider: IExtensionToolProvider): void;
  setExtensionContextProvider(provider: IExtensionContextProvider): void;
}

export const IAiService = createServiceIdentifier<IAiService>('aiService');

/** query()/agentQuery()'s fallback when options.sessionId is omitted — only direct/test callers ever hit this; ipc.ts always supplies a real one. */
const DEFAULT_SESSION_ID = '__default__';

/** Restructured from main/services/ai.ts's free-standing functions into an injectable instance with real ILogService/IDatabaseService deps and a caller-supplied sink; not tested against real provider APIs (no live network calls in CI) — provider-selection/missing-key paths and the streaming parsers are tested against mocks instead. */
export class AiService implements IAiService {
  static readonly inject = [ILogService, IDatabaseService, IFileSystemService, ISearchService, IGitService, IImpactAnalysisService] as const;
  constructor(
    private readonly logService: ILogService,
    private readonly databaseService: IDatabaseService,
    private readonly fileSystemService: IFileSystemService,
    private readonly searchService: ISearchService,
    private readonly gitService: IGitService,
    private readonly impactAnalysisService: IImpactAnalysisService,
  ) {}

  // Keyed by sessionId (see AiQueryOptions.sessionId) so concurrent queries — Parallel Agent Threads — each get their own cancellation scope; a query that omits sessionId (direct/test callers only, never IPC) shares DEFAULT_SESSION_ID with every other such caller, reproducing the old single-controller behavior exactly.
  private activeAbortControllers = new Map<string, AbortController>();
  // Separate from activeAbortControllers: inline completions fire on every keystroke and must not cancel (or be cancelled by) an in-progress chat request.
  private activeInlineAbortController: AbortController | null = null;
  // requestId -> {sessionId, resolve} so abort(sessionId) flushes only that session's pending approvals as denied, not every session's — Stop in one thread must not silently deny another thread's still-running approval prompt.
  private pendingApprovals = new Map<string, { sessionId: string; resolve: (approved: boolean) => void }>();
  // Extension-contributed AI tools/context, set post-construction to avoid a required 6th constructor arg every direct `new AiService(...)` in tests would need.
  private extensionToolProvider: IExtensionToolProvider | null = null;
  private extensionContextProvider: IExtensionContextProvider | null = null;

  setExtensionToolProvider(provider: IExtensionToolProvider): void {
    this.extensionToolProvider = provider;
  }

  setExtensionContextProvider(provider: IExtensionContextProvider): void {
    this.extensionContextProvider = provider;
  }

  abort(sessionId: string = DEFAULT_SESSION_ID): void {
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(sessionId);
    }
    for (const [requestId, entry] of this.pendingApprovals) {
      if (entry.sessionId !== sessionId) continue;
      entry.resolve(false);
      this.pendingApprovals.delete(requestId);
    }
  }

  resolvePendingApproval(requestId: string, approved: boolean): void {
    const entry = this.pendingApprovals.get(requestId);
    if (!entry) {
      return;
    }
    this.pendingApprovals.delete(requestId);
    entry.resolve(approved);
  }

  dispose(): void {
    for (const sessionId of [...this.activeAbortControllers.keys()]) this.abort(sessionId);
    if (this.activeInlineAbortController) {
      this.activeInlineAbortController.abort();
      this.activeInlineAbortController = null;
    }
  }

  /** Fill-in-the-middle completion for editor ghost text — deliberately not routed through query() to skip chat persona/rules/context latency; reuses the same stream parsers, buffered into a string for Monaco's API. */
  async completeInline(request: InlineCompletionRequest): Promise<string> {
    if (this.activeInlineAbortController) {
      this.activeInlineAbortController.abort();
    }
    this.activeInlineAbortController = new AbortController();
    const signal = this.activeInlineAbortController.signal;

    const settings = this.databaseService.getSettings();
    const prompt = `You are a code completion engine embedded in an editor. Given the code immediately before and after the cursor, output ONLY the raw code that should be inserted at the cursor to continue it naturally. Do not repeat any given code. Do not use markdown code fences or explanations. Keep the completion short (a single statement or a few lines at most). If nothing sensible continues the code, output nothing.

Language: ${request.language}

Code before cursor:
"""
${request.prefix}
"""

Code after cursor:
"""
${request.suffix}
"""

Completion:`;

    const genOptions: GenerationOptions = { maxTokens: 256, temperature: 0.2 };

    let buffer = '';
    const sink: AiQuerySink = {
      onChunk: (text) => { buffer += text; },
      onError: () => {},
    };

    try {
      if (request.provider === 'gemini') {
        const apiKey = settings['gemini-key'];
        if (!apiKey) return '';
        await this.streamGemini(apiKey, request.model, prompt, signal, sink, genOptions);
      } else if (request.provider === 'openai') {
        const apiKey = settings['openai-key'];
        if (!apiKey) return '';
        await this.streamOpenAICompatible('https://api.openai.com/v1/chat/completions', apiKey, request.model, prompt, signal, sink, genOptions);
      } else if (request.provider === 'anthropic') {
        const apiKey = settings['anthropic-key'];
        if (!apiKey) return '';
        await this.streamAnthropic(apiKey, request.model, prompt, signal, sink, genOptions);
      } else if (request.provider === 'ollama') {
        const url = settings['ollama-url'] || 'http://localhost:11434/v1/chat/completions';
        await this.streamOpenAICompatible(url, '', request.model || 'llama3', prompt, signal, sink, genOptions);
      } else if (request.provider === 'lm-studio') {
        const url = settings['lm-studio-url'] || 'http://localhost:1234/v1/chat/completions';
        await this.streamOpenAICompatible(url, '', request.model || 'local-model', prompt, signal, sink, genOptions);
      } else if (request.provider === 'custom-openai') {
        const url = settings['custom-openai-url'];
        if (!url) return '';
        const apiKey = settings['custom-openai-key'] || '';
        await this.streamOpenAICompatible(url, apiKey, request.model, prompt, signal, sink, genOptions);
      } else {
        return '';
      }
      return buffer;
    } catch (err: any) {
      if (!isAbortError(err)) {
        this.logService.debug('Inline completion request failed (non-fatal):', err.message || err);
      }
      return '';
    } finally {
      if (this.activeInlineAbortController?.signal === signal) {
        this.activeInlineAbortController = null;
      }
    }
  }

  /** One minimal, near-zero-cost request per provider (1-token completion) rather than a real chat turn; reads the same settings keys query()/agentQuery() use, so it always reflects what a real request would use. */
  async testConnection(provider: string): Promise<AiConnectionTestResult> {
    const settings = this.databaseService.getSettings();
    const fail = (message: string): AiConnectionTestResult => ({ success: false, message });
    const ok = (): AiConnectionTestResult => ({ success: true, message: 'Connected successfully.' });

    try {
      if (provider === 'gemini') {
        const apiKey = settings['gemini-key'];
        if (!apiKey) return fail('Gemini API Key is missing.');
        const ai = new GoogleGenAI({ apiKey });
        await ai.models.generateContent({ model: 'gemini-1.5-flash', contents: 'ping', config: { maxOutputTokens: 1 } });
        return ok();
      }
      if (provider === 'openai') {
        const apiKey = settings['openai-key'];
        if (!apiKey) return fail('OpenAI API Key is missing.');
        await this.pingOpenAICompatible('https://api.openai.com/v1/chat/completions', apiKey, 'gpt-4o-mini');
        return ok();
      }
      if (provider === 'anthropic') {
        const apiKey = settings['anthropic-key'];
        if (!apiKey) return fail('Anthropic API Key is missing.');
        const client = new Anthropic({ apiKey });
        await client.messages.create({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
        return ok();
      }
      if (provider === 'ollama') {
        const url = settings['ollama-url'] || 'http://localhost:11434/v1/chat/completions';
        await this.pingOpenAICompatible(url, '', 'llama3');
        return ok();
      }
      if (provider === 'lm-studio') {
        const url = settings['lm-studio-url'] || 'http://localhost:1234/v1/chat/completions';
        await this.pingOpenAICompatible(url, '', 'local-model');
        return ok();
      }
      if (provider === 'custom-openai') {
        const url = settings['custom-openai-url'];
        if (!url) return fail('Custom OpenAI Endpoint URL is missing.');
        const apiKey = settings['custom-openai-key'] || '';
        await this.pingOpenAICompatible(url, apiKey, 'gpt-4o');
        return ok();
      }
      return fail(`Unsupported AI provider: ${provider}`);
    } catch (err: any) {
      return fail(describeConnectionError(err));
    }
  }

  private async pingOpenAICompatible(baseUrl: string, apiKey: string, model: string): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 300)}`);
    }
  }

  async query(provider: string, model: string, prompt: string, options: AiQueryOptions, sink: AiQuerySink): Promise<void> {
    const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
    // Cancel any existing streaming request in THIS session before starting a new one — other concurrent sessions are untouched.
    this.abort(sessionId);

    const controller = new AbortController();
    this.activeAbortControllers.set(sessionId, controller);
    const signal = controller.signal;

    try {
      const settings = this.databaseService.getSettings();

      // Scoped to the requesting project; without a project_id filter this would leak every project's rules into every other project's chats.
      const rules = options.projectId
        ? this.databaseService.queryAll<{ rule_text: string }>(
            'SELECT rule_text FROM project_rules WHERE is_active = 1 AND project_id = ?',
            [options.projectId],
          )
        : [];
      const memories = options.projectId
        ? this.databaseService.queryAll<{ memory_key: string; memory_val: string }>(
            'SELECT memory_key, memory_val FROM project_memory WHERE project_id = ?',
            [options.projectId],
          )
        : [];

      let fileContext = '';
      if (options.activeFilePath && fs.existsSync(options.activeFilePath)) {
        try {
          const fileContent = fs.readFileSync(options.activeFilePath, 'utf-8');
          const truncated = fileContent.slice(0, 8000);
          fileContext = `Active File: ${options.activeFilePath}\n\`\`\`\n${truncated}\n\`\`\`\n`;
        } catch (err) {
          this.logService.error('Failed to append file context:', err);
        }
      }

      const systemPrompt = `You are SDE Code AI, an expert software developer embedded in SDE Code desktop IDE.
Your response MUST be concise and clear.
${rules.length > 0 ? `\nActive Coding Rules:\n${rules.map((r, i) => `${i + 1}. ${r.rule_text}`).join('\n')}` : ''}
${memories.length > 0 ? `\nProject Context memories:\n${memories.map((m) => `* ${m.memory_key}: ${m.memory_val}`).join('\n')}` : ''}
`;

      const fullPrompt = `${systemPrompt}\n${fileContext}\nUser Request: ${prompt}`;

      if (provider === 'gemini') {
        const apiKey = settings['gemini-key'];
        if (!apiKey) {
          sink.onError('Gemini API Key is missing. Configure it in IDE Settings.');
          return;
        }
        await this.streamGemini(apiKey, model, fullPrompt, signal, sink);
      } else if (provider === 'openai') {
        const apiKey = settings['openai-key'];
        if (!apiKey) {
          sink.onError('OpenAI API Key is missing. Configure it in IDE Settings.');
          return;
        }
        await this.streamOpenAICompatible('https://api.openai.com/v1/chat/completions', apiKey, model, fullPrompt, signal, sink);
      } else if (provider === 'anthropic') {
        const apiKey = settings['anthropic-key'];
        if (!apiKey) {
          sink.onError('Anthropic API Key is missing. Configure it in IDE Settings.');
          return;
        }
        await this.streamAnthropic(apiKey, model, fullPrompt, signal, sink);
      } else if (provider === 'ollama') {
        const url = settings['ollama-url'] || 'http://localhost:11434/v1/chat/completions';
        await this.streamOpenAICompatible(url, '', model || 'llama3', fullPrompt, signal, sink);
      } else if (provider === 'lm-studio') {
        const url = settings['lm-studio-url'] || 'http://localhost:1234/v1/chat/completions';
        await this.streamOpenAICompatible(url, '', model || 'local-model', fullPrompt, signal, sink);
      } else if (provider === 'custom-openai') {
        const url = settings['custom-openai-url'];
        const apiKey = settings['custom-openai-key'] || '';
        if (!url) {
          sink.onError('Custom OpenAI Endpoint URL is missing. Configure it in IDE Settings.');
          return;
        }
        await this.streamOpenAICompatible(url, apiKey, model, fullPrompt, signal, sink);
      } else {
        sink.onError(`Unsupported AI provider requested: ${provider}`);
      }
    } catch (err: any) {
      if (isAbortError(err)) {
        this.logService.debug('AI generation aborted by user.');
      } else {
        this.logService.error('AI Service Error:', err);
        sink.onError(err.message || 'Unknown server error.');
      }
    } finally {
      // Only clear if we're still the current controller for this session — a newer call for the same session (or its own abort()) may have already replaced/removed us, and clearing then would wrongly drop that newer call's controller.
      if (this.activeAbortControllers.get(sessionId) === controller) {
        this.activeAbortControllers.delete(sessionId);
      }
    }
  }

  /** Agent Mode: a multi-turn tool-calling loop distinct from query()'s single-shot flow; each provider builds an AgentProviderAdapter owning its native conversation shape. Tool execution is sequential (never parallel, to avoid two tools racing on the same working-set path), and file mutations stay in-memory until the renderer's acceptAgentFileChange writes them to disk. */
  async agentQuery(provider: string, model: string, prompt: string, options: AiQueryOptions, sink: AgentQuerySink): Promise<void> {
    const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
    this.abort(sessionId);
    const controller = new AbortController();
    this.activeAbortControllers.set(sessionId, controller);
    const signal = controller.signal;
    const onChunk = (text: string) => sink.onChunk(text);

    try {
      const settings = this.databaseService.getSettings();
      const workspacePath = options.workspacePath || '';
      // Falls back to [workspacePath] for older/test callers that don't send workspaceFolders; repo mode ignores this and stays single-repo.
      const workspaceFolders = options.workspaceFolders?.length ? options.workspaceFolders : [workspacePath];
      const isRepoMode = options.mode === 'repo';

      if (isRepoMode && !(await this.gitService.isRepo(workspacePath))) {
        sink.onError('This folder is not a Git repository — Ask Repository has nothing to answer questions about.');
        return;
      }

      // Workspace Trust: an unset/'restricted' folder still allows read-only exploration but loses mutating tools (repo mode is exempt, already read-only). In a multi-root workspace, every folder must be trusted or the whole session is restricted.
      const isRestricted =
        !isRepoMode && workspaceFolders.some((folder) => this.databaseService.getProjectTrustState(folder) !== 'trusted');

      const rules = options.projectId
        ? this.databaseService.queryAll<{ rule_text: string }>(
            'SELECT rule_text FROM project_rules WHERE is_active = 1 AND project_id = ?',
            [options.projectId],
          )
        : [];
      const memories = options.projectId
        ? this.databaseService.queryAll<{ memory_key: string; memory_val: string }>(
            'SELECT memory_key, memory_val FROM project_memory WHERE project_id = ?',
            [options.projectId],
          )
        : [];
      const rulesAndMemories = `${rules.length > 0 ? `\nActive Coding Rules:\n${rules.map((r, i) => `${i + 1}. ${r.rule_text}`).join('\n')}` : ''}
${memories.length > 0 ? `\nProject Context memories:\n${memories.map((m) => `* ${m.memory_key}: ${m.memory_val}`).join('\n')}` : ''}`;

      // Unlike query(), agentQuery() must tell the model the exact active file path — otherwise a guessed filename sails through create_file's existence check and stages a wrongly-named file (e.g. "ContactUs.js" vs the open "ContactUs.jsx"). Skipped in repo mode, which has no active file.
      let fileContext = '';
      if (!isRepoMode && options.activeFilePath && fs.existsSync(options.activeFilePath)) {
        try {
          const fileContent = fs.readFileSync(options.activeFilePath, 'utf-8');
          const truncated = fileContent.slice(0, 8000);
          fileContext = `Active File (this is the exact path — use it verbatim, including its extension, whenever the user refers to "this file" or doesn't name one explicitly; don't guess a different name or extension): ${options.activeFilePath}\n\`\`\`\n${truncated}\n\`\`\`\n\n`;
        } catch (err) {
          this.logService.error('Failed to append file context to agent prompt:', err);
        }
      }
      // Same repo-mode exclusion as fileContext above — context providers report on the active file/prompt, neither of which applies here.
      let extensionContext = '';
      if (!isRepoMode && this.extensionContextProvider) {
        try {
          const contextStrings = await this.extensionContextProvider.collectContext({
            activeFilePath: options.activeFilePath,
            prompt,
          });
          if (contextStrings.length > 0) {
            extensionContext = `Extension-Provided Context:\n${contextStrings.join('\n\n')}\n\n`;
          }
        } catch (err) {
          this.logService.error('Failed to collect extension context for agent prompt:', err);
        }
      }
      const contextPrefix = `${fileContext}${extensionContext}`;
      const augmentedPrompt = contextPrefix ? `${contextPrefix}User Request: ${prompt}` : prompt;

      const systemPrompt = isRepoMode
        ? `You are SDE Code Repo Assistant, embedded in SDE Code desktop IDE. You answer questions about this workspace's git history — commit history, authorship, blame, and code archaeology — using ONLY the four tools provided: git_log, git_show, git_blame, git_search.

You are strictly read-only in this mode. You cannot read or edit source files, run terminal commands, or propose any change to the workspace — if a question requires that, say so plainly instead of attempting it.

Ground every answer in what the tools actually returned. Cite commit hashes (short form is fine), authors, and dates when relevant. If a tool returns no results, say so rather than guessing or inventing an answer.

Use git_log for recent history, git_search to find commits by message text or by a specific code change (content search), git_show to inspect one commit's full metadata and changed-file list, and git_blame to see who last touched each line of a file.
${rulesAndMemories}`
        : `You are SDE Code Agent, an autonomous coding assistant embedded in SDE Code desktop IDE. Use the provided tools to read files, search the codebase, and propose file edits/creations/deletions as needed to complete the user's request. Proposed edits are staged for the user's review, not applied immediately — gather enough context with read_file/list_directory/search_files before proposing changes, and explain what you did in plain prose alongside your tool calls.
${workspaceFolders.length > 1 ? `\nThis is a multi-root workspace with ${workspaceFolders.length} open folders: ${workspaceFolders.join(', ')}. A relative path (e.g. "src/index.ts") resolves against the first folder listed; to target any other folder, use its full absolute path instead.` : ''}
${isRestricted ? '\nThis workspace is in Restricted Mode (not yet trusted by the user) — file-editing tools, run_terminal_command, and any extension-contributed tools are unavailable. Only read_file, list_directory, and search_files can be used. If the user asks you to edit files or run a command, tell them to trust this workspace first from the status bar (the shield icon) or the Command Palette ("Workspace: Trust This Folder").' : ''}
${rulesAndMemories}`;

      // Agent Profiles: a per-tool allow/ask/deny policy the user configures in Settings, defaulting to exactly the pre-Agent-Profiles behavior (everything allowed except run_terminal_command, which always asks) when unset or unparseable.
      let toolPolicies: Partial<Record<AgentPolicyToolName, AgentToolPolicy>> = DEFAULT_AGENT_TOOL_POLICIES;
      const rawToolPolicies = settings['ide-agent-tool-policies'];
      if (rawToolPolicies) {
        try {
          toolPolicies = { ...DEFAULT_AGENT_TOOL_POLICIES, ...JSON.parse(rawToolPolicies) };
        } catch (err) {
          this.logService.error('Failed to parse ide-agent-tool-policies setting, using defaults:', err);
        }
      }
      const requestToolApproval = (toolName: string, argsSummary: string) =>
        new Promise<boolean>((resolve) => {
          const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          this.pendingApprovals.set(requestId, { sessionId, resolve });
          sink.onApprovalRequest({ requestId, toolName, argsSummary });
        });

      const workingSet = new Map<string, AgentFileChange>();
      // Extension tools only apply outside repo mode — repo mode is deliberately locked to exactly the 4 git-only tools above.
      const tools = isRepoMode
        ? createRepoTools({ workspacePath, gitService: this.gitService })
        : [
            ...applyAgentToolPolicies(
              createAgentTools({
                workspaceFolders,
                fileSystemService: this.fileSystemService,
                searchService: this.searchService,
                workingSet,
                signal,
                runCommand: runAgentCommand,
              }).filter((t) => !isRestricted || READ_ONLY_AGENT_TOOL_NAMES.has(t.name)),
              toolPolicies,
              requestToolApproval,
            ),
            // Read-only (queries the already-collected index) — available in Restricted Mode along with the other read-only agent tools above.
            ...createImpactAnalysisTools({ workspaceFolders, impactAnalysisService: this.impactAnalysisService }),
            // Extension tools have unknown side effects with no per-tool way to tell read-only from mutating, so all are withheld in Restricted Mode.
            ...(isRestricted ? [] : this.extensionToolProvider?.listTools() ?? []),
          ];
      const toolsByName = new Map(tools.map((t) => [t.name, t]));

      let adapter: AgentProviderAdapter;
      if (provider === 'gemini') {
        const apiKey = settings['gemini-key'];
        if (!apiKey) {
          sink.onError('Gemini API Key is missing. Configure it in IDE Settings.');
          return;
        }
        adapter = this.createGeminiAgentAdapter(apiKey, model, systemPrompt, tools, augmentedPrompt);
      } else if (provider === 'openai') {
        const apiKey = settings['openai-key'];
        if (!apiKey) {
          sink.onError('OpenAI API Key is missing. Configure it in IDE Settings.');
          return;
        }
        adapter = this.createOpenAICompatibleAgentAdapter('https://api.openai.com/v1/chat/completions', apiKey, model, systemPrompt, tools, augmentedPrompt);
      } else if (provider === 'anthropic') {
        const apiKey = settings['anthropic-key'];
        if (!apiKey) {
          sink.onError('Anthropic API Key is missing. Configure it in IDE Settings.');
          return;
        }
        adapter = this.createAnthropicAgentAdapter(apiKey, model, systemPrompt, tools, augmentedPrompt);
      } else if (provider === 'ollama') {
        const url = settings['ollama-url'] || 'http://localhost:11434/v1/chat/completions';
        adapter = this.createOpenAICompatibleAgentAdapter(url, '', model || 'llama3', systemPrompt, tools, augmentedPrompt);
      } else if (provider === 'lm-studio') {
        const url = settings['lm-studio-url'] || 'http://localhost:1234/v1/chat/completions';
        adapter = this.createOpenAICompatibleAgentAdapter(url, '', model || 'local-model', systemPrompt, tools, augmentedPrompt);
      } else if (provider === 'custom-openai') {
        const url = settings['custom-openai-url'];
        if (!url) {
          sink.onError('Custom OpenAI Endpoint URL is missing. Configure it in IDE Settings.');
          return;
        }
        const apiKey = settings['custom-openai-key'] || '';
        adapter = this.createOpenAICompatibleAgentAdapter(url, apiKey, model, systemPrompt, tools, augmentedPrompt);
      } else {
        sink.onError(`Unsupported AI provider requested: ${provider}`);
        return;
      }

      for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
        const toolCalls = await adapter.sendTurn(signal, onChunk);
        if (toolCalls.length === 0) {
          sink.onDone();
          return;
        }

        const results: Array<{ toolCallId: string; toolName: string; content: string }> = [];
        for (const call of toolCalls) {
          const tool = toolsByName.get(call.toolName);
          const resultText = tool ? await tool.execute(call.args) : `Error: unknown tool "${call.toolName}".`;
          sink.onToolCall({
            toolName: call.toolName,
            argsSummary: JSON.stringify(call.args).slice(0, 300),
            resultSummary: resultText.slice(0, 300),
          });
          results.push({ toolCallId: call.id, toolName: call.toolName, content: resultText });
        }
        adapter.appendToolResults(results);

        if (workingSet.size > 0) {
          sink.onWorkingSetUpdate([...workingSet.values()]);
        }
      }

      sink.onError(`Agent stopped after reaching the maximum number of steps (${MAX_AGENT_ITERATIONS}) without finishing. Any proposed changes so far are still staged for review.`);
    } catch (err: any) {
      if (isAbortError(err)) {
        this.logService.debug('Agent generation aborted by user.');
      } else {
        this.logService.error('Agent Service Error:', err);
        sink.onError(err.message || 'Unknown server error.');
      }
    } finally {
      if (this.activeAbortControllers.get(sessionId) === controller) {
        this.activeAbortControllers.delete(sessionId);
      }
    }
  }

  private createAnthropicAgentAdapter(
    apiKey: string,
    model: string,
    systemPrompt: string,
    tools: AITool[],
    initialPrompt: string,
  ): AgentProviderAdapter {
    const client = new Anthropic({ apiKey });
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initialPrompt }];

    return {
      async sendTurn(signal, onChunk) {
        const stream = client.messages.stream(
          {
            model: model || 'claude-3-5-sonnet',
            max_tokens: 4096,
            system: systemPrompt,
            tools: anthropicTools,
            messages,
          },
          { signal },
        );

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            onChunk(event.delta.text);
          }
        }

        const finalMessage = await stream.finalMessage();
        messages.push({ role: 'assistant', content: finalMessage.content });

        return finalMessage.content
          .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
          .map((block) => ({ id: block.id, toolName: block.name, args: (block.input as Record<string, unknown>) ?? {} }));
      },
      appendToolResults(results) {
        messages.push({
          role: 'user',
          content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.toolCallId, content: r.content })),
        });
      },
    };
  }

  private createGeminiAgentAdapter(
    apiKey: string,
    model: string,
    systemPrompt: string,
    tools: AITool[],
    initialPrompt: string,
  ): AgentProviderAdapter {
    const ai = new GoogleGenAI({ apiKey });
    // parametersJsonSchema accepts our tools' plain JSON Schema objects unmodified; Gemini's own `parameters`/Schema type uses an incompatible Type.OBJECT-style enum.
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parameters,
    }));
    const contents: Content[] = [{ role: 'user', parts: [{ text: initialPrompt }] }];
    let turnCounter = 0;

    return {
      async sendTurn(signal, onChunk) {
        const response = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            tools: [{ functionDeclarations }],
            abortSignal: signal,
          },
        });

        let text = '';
        const calls: AgentToolCallRequest[] = [];
        for await (const chunk of response) {
          if (chunk.text) {
            text += chunk.text;
            onChunk(chunk.text);
          }
          if (chunk.functionCalls) {
            for (const call of chunk.functionCalls) {
              calls.push({
                id: call.id || `gemini_${turnCounter}_${calls.length}`,
                toolName: call.name || '',
                args: call.args ?? {},
              });
            }
          }
        }
        turnCounter += 1;

        const parts: Part[] = [];
        if (text) {
          parts.push({ text });
        }
        for (const call of calls) {
          parts.push({ functionCall: { id: call.id, name: call.toolName, args: call.args } });
        }
        contents.push({ role: 'model', parts });

        return calls;
      },
      appendToolResults(results) {
        contents.push({
          role: 'user',
          parts: results.map((r) => ({
            functionResponse: { id: r.toolCallId, name: r.toolName, response: { result: r.content } },
          })),
        });
      },
    };
  }

  private createOpenAICompatibleAgentAdapter(
    baseUrl: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    tools: AITool[],
    initialPrompt: string,
  ): AgentProviderAdapter {
    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: initialPrompt },
    ];

    return {
      async sendTurn(signal, onChunk) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: model || 'gpt-4o', messages, tools: openaiTools, stream: true }),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API returned status ${response.status}: ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Failed to get stream reader from response.');
        }

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let text = '';
        const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleaned = line.trim();
            if (cleaned === 'data: [DONE]') {
              continue;
            }
            if (cleaned.startsWith('data: ')) {
              try {
                const json = JSON.parse(cleaned.slice(6));
                const delta = json.choices?.[0]?.delta;
                if (delta?.content) {
                  text += delta.content;
                  onChunk(delta.content);
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    const existing = toolCallAccum.get(idx) || { id: tc.id || `tool_${idx}`, name: '', args: '' };
                    if (tc.id) {
                      existing.id = tc.id;
                    }
                    if (tc.function?.name) {
                      existing.name += tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      existing.args += tc.function.arguments;
                    }
                    toolCallAccum.set(idx, existing);
                  }
                }
              } catch {
                // Ignore partial segment parsing errors.
              }
            }
          }
        }

        const calls: AgentToolCallRequest[] = [];
        for (const [, acc] of toolCallAccum) {
          let args: Record<string, unknown> = {};
          try {
            args = acc.args ? JSON.parse(acc.args) : {};
          } catch {
            // Malformed streamed arguments — fall back to an empty args object rather than throwing mid-loop.
          }
          calls.push({ id: acc.id, toolName: acc.name, args });
        }

        messages.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length > 0 && {
            tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.toolName, arguments: JSON.stringify(c.args) } })),
          }),
        });

        return calls;
      },
      appendToolResults(results) {
        for (const r of results) {
          messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
        }
      },
    };
  }

  private async streamGemini(apiKey: string, model: string, prompt: string, signal: AbortSignal, sink: AiQuerySink, genOptions?: GenerationOptions): Promise<void> {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContentStream({
      model,
      contents: prompt,
      config: {
        ...(genOptions?.maxTokens && { maxOutputTokens: genOptions.maxTokens }),
        ...(genOptions?.temperature !== undefined && { temperature: genOptions.temperature }),
        abortSignal: signal,
      },
    });

    for await (const chunk of response) {
      if (chunk.text) {
        sink.onChunk(chunk.text);
      }
    }
  }

  private async streamOpenAICompatible(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string,
    signal: AbortSignal,
    sink: AiQuerySink,
    genOptions?: GenerationOptions,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        ...(genOptions?.maxTokens && { max_tokens: genOptions.maxTokens }),
        ...(genOptions?.temperature !== undefined && { temperature: genOptions.temperature }),
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned status ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Failed to get stream reader from response.');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep last partial line

      for (const line of lines) {
        const cleaned = line.trim();
        if (cleaned === 'data: [DONE]') continue;
        if (cleaned.startsWith('data: ')) {
          try {
            const json = JSON.parse(cleaned.slice(6));
            const chunk = json.choices?.[0]?.delta?.content;
            if (chunk) {
              sink.onChunk(chunk);
            }
          } catch {
            // Ignore partial segment parsing errors.
          }
        }
      }
    }
  }

  private async streamAnthropic(apiKey: string, model: string, prompt: string, signal: AbortSignal, sink: AiQuerySink, genOptions?: GenerationOptions): Promise<void> {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream(
      {
        model: model || 'claude-3-5-sonnet',
        max_tokens: genOptions?.maxTokens || 4000,
        ...(genOptions?.temperature !== undefined && { temperature: genOptions.temperature }),
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        sink.onChunk(event.delta.text);
      }
    }
  }
}

/** @anthropic-ai/sdk wraps an AbortSignal into its own APIUserAbortError rather than the raw AbortError fetch throws natively — check both shapes rather than assuming one. */
function isAbortError(err: any): boolean {
  return err?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError;
}

/** Turns an SDK/fetch error into a one-line message fit for the Settings UI's test-connection status text. */
function describeConnectionError(err: any): string {
  const raw = (err?.message || String(err) || 'Unknown error').replace(/\s+/g, ' ').trim();
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}
