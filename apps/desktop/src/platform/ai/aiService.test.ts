import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { AiService } from './aiService';
import { DatabaseService } from '../db';
import { FakeLogService } from '../log';
import { FileSystemService } from '../fs';
import { SearchService } from '../search';
import { GitService } from '../git';
import { ImpactAnalysisService } from '../codeMap';
import type { AgentToolCallEvent } from '@sde-code/protocol';
import { MAX_AGENT_ITERATIONS } from './agentTypes';
import { ExtensionHostService } from '../../extension-host/runtime';
import { AIToolRegistry } from '../../extension-host/registries/aiToolRegistry';
import { AIContextProviderRegistry } from '../../extension-host/registries/aiContextProviderRegistry';

/** Builds a fake fetch Response whose body streams the given chunks (already-encoded strings). */
function fakeStreamResponse(chunks: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = {
    getReader() {
      return {
        async read() {
          if (i < chunks.length) {
            return { done: false, value: encoder.encode(chunks[i++]) };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
  return {
    ok,
    status,
    body,
    text: async () => (ok ? '' : 'error body'),
  } as unknown as Response;
}

/** Wraps a list of items into an async-iterable stream, mirroring what both SDKs' streaming methods return. */
async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

/**
 * A stream that never yields and rejects with an AbortError-shaped error once
 * the given signal fires — mirrors @google/genai's real abort behavior
 * (confirmed empirically: a plain DOMException named 'AbortError').
 *
 * Registers the abort listener eagerly (at construction, not inside next())
 * and also checks signal.aborted synchronously in next() as a fallback —
 * next() is only reached after an extra microtask tick (the mock's
 * Promise.resolve() wrapper, matching the real SDK's `await` before the
 * stream is iterable), by which point a synchronous abort() call from the
 * test could already have fired and been missed by a listener added later.
 */
function hangingUntilAborted(signal?: AbortSignal) {
  const makeAbortError = () => Object.assign(new Error('This operation was aborted.'), { name: 'AbortError' });
  let rejectPending: ((err: Error) => void) | null = null;
  signal?.addEventListener('abort', () => rejectPending?.(makeAbortError()));
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (signal?.aborted) return Promise.reject(makeAbortError());
          return new Promise((_resolve, reject) => {
            rejectPending = reject;
          });
        },
      };
    },
  };
}

// Confirmed empirically (real client against a local mock server, mid-stream
// abort): @anthropic-ai/sdk wraps an aborted request into its own
// APIUserAbortError — .name stays 'Error', only `instanceof` distinguishes it
// from a real failure. Mock must reproduce that exact shape, not a plain
// AbortError, or the isAbortError() contract in aiService.ts goes untested.
const { anthropicStreamMock, anthropicCreateMock, geminiStreamMock, geminiGenerateMock, FakeAPIUserAbortError } = vi.hoisted(() => {
  class FakeAPIUserAbortError extends Error {}
  return {
    anthropicStreamMock: vi.fn(),
    anthropicCreateMock: vi.fn(),
    geminiStreamMock: vi.fn(),
    geminiGenerateMock: vi.fn(),
    FakeAPIUserAbortError,
  };
});

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      stream: (...args: unknown[]) => anthropicStreamMock(...args),
      create: (...args: unknown[]) => anthropicCreateMock(...args),
    };
    static APIUserAbortError = FakeAPIUserAbortError;
  }
  return { default: FakeAnthropic };
});

vi.mock('@google/genai', () => {
  class FakeGoogleGenAI {
    models = {
      generateContentStream: (...args: unknown[]) => geminiStreamMock(...args),
      generateContent: (...args: unknown[]) => geminiGenerateMock(...args),
    };
  }
  return { GoogleGenAI: FakeGoogleGenAI };
});

describe('AiService', () => {
  let tmpDir: string;
  let dbPath: string;
  let workspaceDir: string;
  let db: DatabaseService;
  let log: FakeLogService;
  let service: AiService;
  let chunks: string[];
  let errors: string[];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ai-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    workspaceDir = path.join(tmpDir, 'workspace').replace(/\\/g, '/');
    fs.mkdirSync(workspaceDir);
    log = new FakeLogService();
    db = new DatabaseService(new FakeLogService());
    await db.initialize(dbPath);
    // Workspace Trust defaults to Restricted Mode (see agentQuery's
    // isRestricted check) — trust the test workspace by default so every
    // existing test below keeps exercising the full (mutating) tool set it
    // was written against. Tests specifically covering Restricted Mode use
    // their own separate, deliberately-untrusted workspace instead.
    db.setProjectTrustState(workspaceDir, 'trusted');
    service = new AiService(
      log,
      db,
      new FileSystemService(new FakeLogService()),
      new SearchService(new FakeLogService()),
      new GitService(new FakeLogService()),
      new ImpactAnalysisService(db),
    );
    chunks = [];
    errors = [];
    anthropicStreamMock.mockReset();
    anthropicCreateMock.mockReset();
    geminiStreamMock.mockReset();
    geminiGenerateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sink = () => ({
    onChunk: (text: string) => chunks.push(text),
    onError: (message: string) => errors.push(message),
  });

  /** Fakes @anthropic-ai/sdk's MessageStream: async-iterable content_block_delta events, plus finalMessage(). */
  const anthropicAgentStream = (deltaEvents: unknown[], finalMessage: unknown) => ({
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i < deltaEvents.length) return { done: false, value: deltaEvents[i++] };
          return { done: true, value: undefined };
        },
      };
    },
    finalMessage: async () => finalMessage,
  });

  it('reports an error for an unsupported provider, without any network call', async () => {
    await service.query('not-a-real-provider', 'model', 'hello', {}, sink());
    expect(errors).toEqual(['Unsupported AI provider requested: not-a-real-provider']);
    expect(chunks).toEqual([]);
  });

  it.each(['gemini', 'openai', 'anthropic'])('reports a missing-API-key error for %s without any network call', async (provider) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await service.query(provider, 'model', 'hello', {}, sink());

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/API Key is missing/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(geminiStreamMock).not.toHaveBeenCalled();
    expect(anthropicStreamMock).not.toHaveBeenCalled();
  });

  it('reports a missing-URL error for custom-openai without any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await service.query('custom-openai', 'model', 'hello', {}, sink());

    expect(errors).toEqual(['Custom OpenAI Endpoint URL is missing. Configure it in IDE Settings.']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('relays a Gemini generateContentStream response into onChunk calls', async () => {
    db.setSetting('gemini-key', 'test-key');
    geminiStreamMock.mockResolvedValue(toAsyncIterable([{ text: 'Hello' }, { text: ' world' }]));

    await service.query('gemini', 'gemini-2.0-flash', 'hi', {}, sink());

    expect(chunks.join('')).toBe('Hello world');
  });

  it('parses an OpenAI-compatible SSE stream into onChunk calls, ignoring [DONE]', async () => {
    db.setSetting('openai-key', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeStreamResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
          'data: [DONE]\n',
        ]),
      ),
    );

    await service.query('openai', 'gpt-4o', 'hi', {}, sink());

    expect(chunks.join('')).toBe('Hello');
  });

  it('relays an Anthropic messages.stream response into onChunk calls', async () => {
    db.setSetting('anthropic-key', 'test-key');
    anthropicStreamMock.mockReturnValue(
      toAsyncIterable([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' there' } },
      ]),
    );

    await service.query('anthropic', 'claude-3-5-sonnet', 'hi', {}, sink());

    expect(chunks.join('')).toBe('Hi there');
  });

  it('surfaces a Gemini SDK error as sink.onError instead of throwing uncaught', async () => {
    db.setSetting('gemini-key', 'test-key');
    geminiStreamMock.mockRejectedValue(Object.assign(new Error('{"error":{"message":"invalid x-api-key"}}'), { name: 'ApiError', status: 401 }));

    await service.query('gemini', 'model', 'hi', {}, sink());

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/invalid x-api-key/);
  });

  it('surfaces an Anthropic SDK error as sink.onError instead of throwing uncaught', async () => {
    db.setSetting('anthropic-key', 'test-key');
    anthropicStreamMock.mockImplementation(() => {
      throw Object.assign(new Error('401 {"error":{"message":"invalid x-api-key"}}'), { status: 401 });
    });

    await service.query('anthropic', 'model', 'hi', {}, sink());

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/invalid x-api-key/);
  });

  it('abort() cancels an in-flight Gemini request — the AbortError is swallowed, not surfaced as an error', async () => {
    db.setSetting('gemini-key', 'test-key');
    geminiStreamMock.mockImplementation((params: { config?: { abortSignal?: AbortSignal } }) =>
      Promise.resolve(hangingUntilAborted(params.config?.abortSignal)),
    );

    const queryPromise = service.query('gemini', 'model', 'hi', {}, sink());
    service.abort();
    await queryPromise;

    expect(errors).toEqual([]); // AbortError is logged (debug), not reported to the sink as an error
  });

  it('abort() cancels an in-flight Anthropic request — its APIUserAbortError is swallowed, not surfaced as an error', async () => {
    db.setSetting('anthropic-key', 'test-key');
    // Empirically confirmed shape (real client against a local mock server,
    // mid-stream abort): the SDK rejects the pending stream read with its own
    // APIUserAbortError, whose .name stays 'Error' — only `instanceof`
    // distinguishes it. This is exactly the contract isAbortError() checks.
    anthropicStreamMock.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => ({
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise((_resolve, reject) => {
              options.signal?.addEventListener('abort', () => reject(new FakeAPIUserAbortError('Request was aborted.')));
            }),
        };
      },
    }));

    const queryPromise = service.query('anthropic', 'model', 'hi', {}, sink());
    service.abort();
    await queryPromise;

    expect(errors).toEqual([]); // APIUserAbortError is logged (debug), not reported to the sink as an error
  });

  it('abort(sessionId) cancels only that session — a concurrent session with a different id keeps streaming and completes normally (Parallel Agent Threads isolation)', async () => {
    db.setSetting('gemini-key', 'test-key');
    db.setSetting('anthropic-key', 'test-key');
    // Session A: Gemini, hangs until aborted.
    geminiStreamMock.mockImplementation((params: { config?: { abortSignal?: AbortSignal } }) =>
      Promise.resolve(hangingUntilAborted(params.config?.abortSignal)),
    );
    // Session B: Anthropic, streams normally and is never touched.
    anthropicStreamMock.mockReturnValue(
      toAsyncIterable([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'still' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' running' } },
      ]),
    );

    const sessionAChunks: string[] = [];
    const sessionAErrors: string[] = [];
    const sessionBChunks: string[] = [];
    const sessionBErrors: string[] = [];

    const queryA = service.query('gemini', 'model', 'hi', { sessionId: 'session-a' }, {
      onChunk: (t) => sessionAChunks.push(t),
      onError: (m) => sessionAErrors.push(m),
    });
    const queryB = service.query('anthropic', 'model', 'hi', { sessionId: 'session-b' }, {
      onChunk: (t) => sessionBChunks.push(t),
      onError: (m) => sessionBErrors.push(m),
    });

    service.abort('session-a');
    await Promise.all([queryA, queryB]);

    expect(sessionAErrors).toEqual([]); // AbortError swallowed, not surfaced
    expect(sessionAChunks).toEqual([]);
    expect(sessionBErrors).toEqual([]);
    expect(sessionBChunks.join('')).toBe('still running'); // untouched by session A's abort
  });

  it('includes the requesting project\'s active rules and memories in the prompt sent to Gemini', async () => {
    db.run("INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES ('r1', 'p1', 'Always write tests', 1)");
    db.run("INSERT INTO project_memory (id, project_id, memory_key, memory_val) VALUES ('m1', 'p1', 'framework', 'React')");
    db.setSetting('gemini-key', 'test-key');
    geminiStreamMock.mockResolvedValue(toAsyncIterable([]));

    await service.query('gemini', 'model', 'hi', { projectId: 'p1' }, sink());

    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    const promptText = geminiStreamMock.mock.calls[0][0].contents as string;
    expect(promptText).toContain('Always write tests');
    expect(promptText).toContain('framework: React');
  });

  it('never leaks another project\'s rules/memories, and injects none at all without a projectId', async () => {
    db.run("INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES ('r1', 'other-project', 'Secret other-project rule', 1)");
    db.run("INSERT INTO project_memory (id, project_id, memory_key, memory_val) VALUES ('m1', 'other-project', 'secret', 'value')");
    db.setSetting('gemini-key', 'test-key');
    geminiStreamMock.mockResolvedValue(toAsyncIterable([]));

    await service.query('gemini', 'model', 'hi', { projectId: 'p1' }, sink());
    const scopedPrompt = geminiStreamMock.mock.calls[0][0].contents as string;
    expect(scopedPrompt).not.toContain('Secret other-project rule');
    expect(scopedPrompt).not.toContain('secret: value');

    await service.query('gemini', 'model', 'hi', {}, sink());
    const unscopedPrompt = geminiStreamMock.mock.calls[1][0].contents as string;
    expect(unscopedPrompt).not.toContain('Secret other-project rule');
    expect(unscopedPrompt).not.toContain('secret: value');
  });

  describe('agentQuery', () => {
    it('executes a real tool call, feeds the result back to the next turn, and calls onDone() once the model stops requesting tools', async () => {
      fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'file contents here');
      db.setSetting('anthropic-key', 'test-key');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], {
            content: [{ type: 'tool_use', id: 'call_1', name: 'read_file', input: { filePath: 'a.txt' } }],
          }),
        )
        .mockReturnValueOnce(
          anthropicAgentStream(
            [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done reading.' } }],
            { content: [{ type: 'text', text: 'Done reading.' }] },
          ),
        );

      const toolCalls: AgentToolCallEvent[] = [];
      let done = false;
      await service.agentQuery('anthropic', 'model', 'read a.txt', { workspacePath: workspaceDir }, {
        onChunk: (text) => chunks.push(text),
        onToolCall: (info) => toolCalls.push(info),
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(errors).toEqual([]);
      expect(done).toBe(true);
      expect(chunks.join('')).toBe('Done reading.');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe('read_file');
      expect(toolCalls[0].resultSummary).toContain('file contents here');
      expect(anthropicStreamMock).toHaveBeenCalledTimes(2);

      const secondCallMessages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find(
        (m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
      );
      expect(toolResultMessage.content[0].tool_use_id).toBe('call_1');
      expect(toolResultMessage.content[0].content).toContain('file contents here');
    });

    it('calls onWorkingSetUpdate with the staged change after a file-mutating tool runs, never writing to disk directly', async () => {
      fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'old content');
      db.setSetting('anthropic-key', 'test-key');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], {
            content: [
              { type: 'tool_use', id: 'call_1', name: 'propose_file_edit', input: { filePath: 'a.txt', content: 'new content' } },
            ],
          }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done.' }] }));

      const workingSetUpdates: unknown[][] = [];
      let done = false;
      await service.agentQuery('anthropic', 'model', 'update a.txt', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: (changes) => workingSetUpdates.push(changes),
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(true);
      expect(errors).toEqual([]);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.txt'), 'utf-8')).toBe('old content');
      expect(workingSetUpdates).toHaveLength(1);
      expect(workingSetUpdates[0]).toEqual([
        { filePath: `${workspaceDir}/a.txt`, originalContent: 'old content', proposedContent: 'new content', isNew: false, isDeleted: false },
      ]);
    });

    it('injects the active file\'s exact path and content into the prompt, so the model has no reason to guess a different filename', async () => {
      const activeFilePath = path.join(workspaceDir, 'ContactUs.jsx').replace(/\\/g, '/');
      fs.writeFileSync(activeFilePath, '<div className="col-md-6">broken jsx');
      db.setSetting('anthropic-key', 'test-key');

      anthropicStreamMock.mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'ok' }] }));

      await service.agentQuery('anthropic', 'model', 'fix the errors in this file', { workspacePath: workspaceDir, activeFilePath }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => {},
      });

      expect(errors).toEqual([]);
      const firstCallMessages = anthropicStreamMock.mock.calls[0][0].messages;
      const sentPrompt = firstCallMessages[0].content;
      expect(sentPrompt).toContain(activeFilePath);
      expect(sentPrompt).toContain('broken jsx');
      expect(sentPrompt).toContain('fix the errors in this file');
    });

    it('does not inject file context in repo mode (read-only, no active file to speak of)', async () => {
      execSync('git init -q', { cwd: workspaceDir });
      execSync('git config user.email "t@t.com" && git config user.name t', { cwd: workspaceDir });
      fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'x');
      execSync('git add -A && git commit -q -m init', { cwd: workspaceDir });

      const activeFilePath = path.join(workspaceDir, 'a.txt').replace(/\\/g, '/');
      db.setSetting('anthropic-key', 'test-key');
      anthropicStreamMock.mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'ok' }] }));

      await service.agentQuery('anthropic', 'model', 'what changed?', { workspacePath: workspaceDir, activeFilePath, mode: 'repo' }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => {},
      });

      expect(errors).toEqual([]);
      const sentPrompt = anthropicStreamMock.mock.calls[0][0].messages[0].content;
      expect(sentPrompt).toBe('what changed?');
    });

    it('stops after MAX_AGENT_ITERATIONS and reports an error instead of hanging forever', async () => {
      db.setSetting('anthropic-key', 'test-key');
      anthropicStreamMock.mockImplementation(() =>
        anthropicAgentStream([], {
          content: [{ type: 'tool_use', id: 'call_x', name: 'list_directory', input: { dirPath: '.' } }],
        }),
      );

      let done = false;
      await service.agentQuery('anthropic', 'model', 'loop forever', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(new RegExp(`maximum number of steps \\(${MAX_AGENT_ITERATIONS}\\)`));
      expect(anthropicStreamMock).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
    });

    it('run_terminal_command executes a real command once approved, and feeds the real result back to the next turn', async () => {
      db.setSetting('anthropic-key', 'test-key');
      const markerFile = path.join(workspaceDir, 'ran.txt');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], {
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'run_terminal_command',
                input: { command: `node -e "require('fs').writeFileSync('ran.txt', 'ran'); console.log('approved output')"` },
              },
            ],
          }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done.' }] }));

      let approvalRequest: { requestId: string; toolName: string; argsSummary: string } | null = null;
      let done = false;
      const queryPromise = service.agentQuery('anthropic', 'model', 'run a command', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: (request) => {
          approvalRequest = request;
        },
        onError: (message) => errors.push(message),
        onDone: () => {
          done = true;
        },
      });

      await vi.waitFor(() => expect(approvalRequest).not.toBeNull());
      service.resolvePendingApproval(approvalRequest!.requestId, true);
      await queryPromise;

      expect(done).toBe(true);
      expect(errors).toEqual([]);
      expect(approvalRequest!.argsSummary).toContain('approved output');
      expect(fs.existsSync(markerFile)).toBe(true);

      const secondCallMessages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
      expect(toolResultMessage.content[0].content).toContain('approved output');
    });

    it('run_terminal_command does not run the real command when denied, and feeds that back to the model', async () => {
      db.setSetting('anthropic-key', 'test-key');
      const markerFile = path.join(workspaceDir, 'should-not-exist.txt');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], {
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'run_terminal_command',
                input: { command: `node -e "require('fs').writeFileSync('should-not-exist.txt', '1')"` },
              },
            ],
          }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Understood.' }] }));

      let approvalRequest: { requestId: string; toolName: string; argsSummary: string } | null = null;
      let done = false;
      const queryPromise = service.agentQuery('anthropic', 'model', 'try something risky', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: (request) => {
          approvalRequest = request;
        },
        onError: (message) => errors.push(message),
        onDone: () => {
          done = true;
        },
      });

      await vi.waitFor(() => expect(approvalRequest).not.toBeNull());
      service.resolvePendingApproval(approvalRequest!.requestId, false);
      await queryPromise;

      expect(done).toBe(true);
      expect(fs.existsSync(markerFile)).toBe(false);

      const secondCallMessages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
      expect(toolResultMessage.content[0].content).toMatch(/denied/i);
    });

    it('abort() flushes a pending run_terminal_command approval as denied instead of hanging forever', async () => {
      db.setSetting('anthropic-key', 'test-key');
      const markerFile = path.join(workspaceDir, 'should-not-exist-either.txt');

      anthropicStreamMock.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => {
        if (options.signal?.aborted) {
          throw new FakeAPIUserAbortError('Request was aborted.');
        }
        return anthropicAgentStream([], {
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'run_terminal_command',
              input: { command: `node -e "require('fs').writeFileSync('should-not-exist-either.txt', '1')"` },
            },
          ],
        });
      });

      let approvalRequest: { requestId: string; toolName: string; argsSummary: string } | null = null;
      const queryPromise = service.agentQuery('anthropic', 'model', 'run something', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: (request) => {
          approvalRequest = request;
        },
        onError: (message) => errors.push(message),
        onDone: () => {},
      });

      await vi.waitFor(() => expect(approvalRequest).not.toBeNull());
      service.abort();
      await queryPromise; // must resolve, not hang — abort() flushed the pending approval as false

      expect(errors).toEqual([]);
      expect(fs.existsSync(markerFile)).toBe(false);
    });

    it('abort(sessionId) flushes only that session\'s own pending approval — a concurrent session\'s approval stays pending (Parallel Agent Threads isolation)', async () => {
      db.setSetting('anthropic-key', 'test-key');

      anthropicStreamMock.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => {
        if (options.signal?.aborted) throw new FakeAPIUserAbortError('Request was aborted.');
        return anthropicAgentStream([], {
          content: [{ type: 'tool_use', id: 'call_1', name: 'run_terminal_command', input: { command: 'echo hi' } }],
        });
      });

      let approvalA: { requestId: string; toolName: string; argsSummary: string } | null = null;
      let approvalB: { requestId: string; toolName: string; argsSummary: string } | null = null;

      const queryA = service.agentQuery('anthropic', 'model', 'run something', { workspacePath: workspaceDir, sessionId: 'session-a' }, {
        onChunk: () => {}, onToolCall: () => {}, onWorkingSetUpdate: () => {},
        onApprovalRequest: (request) => { approvalA = request; },
        onError: () => {}, onDone: () => {},
      });
      const queryB = service.agentQuery('anthropic', 'model', 'run something else', { workspacePath: workspaceDir, sessionId: 'session-b' }, {
        onChunk: () => {}, onToolCall: () => {}, onWorkingSetUpdate: () => {},
        onApprovalRequest: (request) => { approvalB = request; },
        onError: () => {}, onDone: () => {},
      });

      await vi.waitFor(() => { expect(approvalA).not.toBeNull(); expect(approvalB).not.toBeNull(); });

      service.abort('session-a');
      await queryA; // resolves — session A's own approval was denied by its own abort

      // Session B's approval must still be pending — prove it by giving any wrongful cross-session flush a chance to have resolved queryB, then confirming it hasn't.
      let queryBSettled = false;
      queryB.then(() => { queryBSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(queryBSettled).toBe(false);

      anthropicStreamMock.mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done B.' }] }));
      service.resolvePendingApproval(approvalB!.requestId, true);
      await queryB;
      expect(queryBSettled).toBe(true);
    });

    it('dispatches a real extension-contributed AI tool, and injects real extension context into the prompt', async () => {
      db.setSetting('anthropic-key', 'test-key');

      const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ai-ext-test-'));
      fs.mkdirSync(path.join(extDir, 'ext.demo/dist'), { recursive: true });
      fs.writeFileSync(
        path.join(extDir, 'ext.demo/manifest.json'),
        JSON.stringify({ id: 'ext.demo', name: 'ext.demo', version: '1.0.0', publisher: 'test', main: 'dist/index.js', activationEvents: ['*'] }),
      );
      fs.writeFileSync(
        path.join(extDir, 'ext.demo/dist/index.js'),
        `
        const { registerAITool, registerContextProvider } = require('@sde-code/sdk');
        module.exports = {
          activate: () => {
            registerAITool({
              name: 'demo_shout',
              description: 'Uppercases the given text',
              parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
              execute: async (args) => String(args.text).toUpperCase(),
            });
            registerContextProvider({
              id: 'ext.demo.context',
              provideContext: async () => 'the user prefers concise answers',
            });
          },
        };
        `,
      );
      const extensionHostService = new ExtensionHostService(new FakeLogService());
      await extensionHostService.discoverExtensions(extDir);
      await extensionHostService.fireActivationEvent('onStartupFinished');
      service.setExtensionToolProvider(new AIToolRegistry(extensionHostService));
      service.setExtensionContextProvider(new AIContextProviderRegistry(extensionHostService));

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], {
            content: [{ type: 'tool_use', id: 'call_1', name: 'demo_shout', input: { text: 'hello from the model' } }],
          }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done.' }] }));

      let done = false;
      await service.agentQuery('anthropic', 'model', 'shout this for me', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(true);
      expect(errors).toEqual([]);

      const firstCallPrompt = anthropicStreamMock.mock.calls[0][0].messages[0].content;
      expect(firstCallPrompt).toContain('the user prefers concise answers');

      const secondCallMessages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
      expect(toolResultMessage.content[0].content).toBe('HELLO FROM THE MODEL');

      extensionHostService.dispose();
      fs.rmSync(extDir, { recursive: true, force: true });
    });

    it('Restricted Mode (untrusted workspace): filters out mutating/terminal/extension tools, keeps read-only ones working', async () => {
      db.setSetting('anthropic-key', 'test-key');
      // Deliberately NOT trusted — no db.setProjectTrustState call for this
      // path, unlike the shared beforeEach's workspaceDir.
      const restrictedDir = path.join(tmpDir, 'untrusted-workspace').replace(/\\/g, '/');
      fs.mkdirSync(restrictedDir);
      fs.writeFileSync(path.join(restrictedDir, 'a.txt'), 'hello');

      const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ai-restricted-ext-test-'));
      fs.mkdirSync(path.join(extDir, 'ext.demo/dist'), { recursive: true });
      fs.writeFileSync(
        path.join(extDir, 'ext.demo/manifest.json'),
        JSON.stringify({ id: 'ext.demo', name: 'ext.demo', version: '1.0.0', publisher: 'test', main: 'dist/index.js', activationEvents: ['*'] }),
      );
      fs.writeFileSync(
        path.join(extDir, 'ext.demo/dist/index.js'),
        `
        const { registerAITool } = require('@sde-code/sdk');
        module.exports = { activate: () => registerAITool({ name: 'demo_shout', description: 'x', parameters: {}, execute: async () => 'x' }) };
        `,
      );
      const extensionHostService = new ExtensionHostService(new FakeLogService());
      await extensionHostService.discoverExtensions(extDir);
      await extensionHostService.fireActivationEvent('onStartupFinished');
      service.setExtensionToolProvider(new AIToolRegistry(extensionHostService));

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], { content: [{ type: 'tool_use', id: 'call_1', name: 'create_file', input: { filePath: 'new.txt', content: 'x' } }] }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'tool_use', id: 'call_2', name: 'demo_shout', input: {} }] }))
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'tool_use', id: 'call_3', name: 'list_directory', input: { dirPath: '.' } }] }))
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done.' }] }));

      let done = false;
      await service.agentQuery('anthropic', 'model', 'do stuff', { workspacePath: restrictedDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(true);
      expect(errors).toEqual([]);

      // AiService's Anthropic adapter mutates one shared `messages` array
      // across turns rather than passing a fresh array per call, so every
      // mock.calls[i][0].messages reference ends up pointing at the same
      // (now fully populated) final array — read tool_result content off
      // the last call instead of trying to diff per-call snapshots.
      const finalMessages = anthropicStreamMock.mock.calls[anthropicStreamMock.mock.calls.length - 1][0].messages;
      const toolResults = finalMessages
        .filter((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
        .map((m: any) => m.content[0].content as string);

      expect(toolResults[0]).toMatch(/unknown tool/i); // create_file — filtered out (mutating)
      expect(toolResults[1]).toMatch(/unknown tool/i); // demo_shout — filtered out (extension tool)
      expect(toolResults[2]).not.toMatch(/unknown tool/i); // list_directory — read-only, still available
      expect(toolResults[2]).toContain('a.txt');

      extensionHostService.dispose();
      fs.rmSync(extDir, { recursive: true, force: true });
    });

    it('Restricted Mode applies to the whole multi-root session if even one open folder is untrusted', async () => {
      db.setSetting('anthropic-key', 'test-key');
      const secondDir = path.join(tmpDir, 'second-workspace').replace(/\\/g, '/');
      fs.mkdirSync(secondDir);
      // workspaceDir (the primary folder) IS trusted via beforeEach; secondDir deliberately isn't.

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], { content: [{ type: 'tool_use', id: 'call_1', name: 'create_file', input: { filePath: 'new.txt', content: 'x' } }] }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done.' }] }));

      let done = false;
      await service.agentQuery('anthropic', 'model', 'create a file', { workspacePath: workspaceDir, workspaceFolders: [workspaceDir, secondDir] }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(true);
      expect(errors).toEqual([]);
      const messages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResult = messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
      expect(toolResult.content[0].content).toMatch(/unknown tool/i);
    });

    it('a fully-trusted multi-root session keeps mutating tools available', async () => {
      db.setSetting('anthropic-key', 'test-key');
      const secondDir = path.join(tmpDir, 'second-trusted-workspace').replace(/\\/g, '/');
      fs.mkdirSync(secondDir);
      db.setProjectTrustState(secondDir, 'trusted');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], { content: [{ type: 'tool_use', id: 'call_1', name: 'create_file', input: { filePath: 'new.txt', content: 'x' } }] }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Done.' }] }));

      await service.agentQuery('anthropic', 'model', 'create a file', { workspacePath: workspaceDir, workspaceFolders: [workspaceDir, secondDir] }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => {},
      });

      expect(errors).toEqual([]);
      const messages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResult = messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
      expect(toolResult.content[0].content).not.toMatch(/unknown tool/i);
    });

    it('abort() cancels an in-flight agentQuery run — the abort error is swallowed, not surfaced as an error', async () => {
      db.setSetting('anthropic-key', 'test-key');
      anthropicStreamMock.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => ({
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(new FakeAPIUserAbortError('Request was aborted.')));
              }),
          };
        },
        finalMessage: () => new Promise(() => {}),
      }));

      const queryPromise = service.agentQuery('anthropic', 'model', 'hi', { workspacePath: workspaceDir }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => {},
      });
      service.abort();
      await queryPromise;

      expect(errors).toEqual([]);
    });
  });

  describe('agentQuery repo mode', () => {
    const initRepo = () => {
      execSync('git init -q', { cwd: workspaceDir });
      execSync('git config user.email "test@example.com"', { cwd: workspaceDir });
      execSync('git config user.name "Test"', { cwd: workspaceDir });
    };

    it('reports an error instead of calling any tool when the workspace is not a git repository', async () => {
      db.setSetting('anthropic-key', 'test-key');

      let done = false;
      await service.agentQuery('anthropic', 'model', 'what changed recently?', { workspacePath: workspaceDir, mode: 'repo' }, {
        onChunk: () => {},
        onToolCall: () => {},
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(false);
      expect(errors).toEqual(['This folder is not a Git repository — Ask Repository has nothing to answer questions about.']);
      expect(anthropicStreamMock).not.toHaveBeenCalled();
    });

    it('only dispatches git_* tools — an attempted file-editing tool call comes back as an unknown-tool error, proving the tool set is genuinely swapped', async () => {
      initRepo();
      db.setSetting('anthropic-key', 'test-key');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], {
            content: [{ type: 'tool_use', id: 'call_1', name: 'propose_file_edit', input: { filePath: 'a.txt', content: 'x' } }],
          }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'Cannot edit files in this mode.' }] }));

      const toolCalls: AgentToolCallEvent[] = [];
      let done = false;
      await service.agentQuery('anthropic', 'model', 'edit a.txt', { workspacePath: workspaceDir, mode: 'repo' }, {
        onChunk: () => {},
        onToolCall: (info) => toolCalls.push(info),
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(true);
      expect(errors).toEqual([]);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].resultSummary).toBe('Error: unknown tool "propose_file_edit".');

      const secondCallMessages = anthropicStreamMock.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
      expect(toolResultMessage.content[0].content).toBe('Error: unknown tool "propose_file_edit".');
    });

    it('executes a real git_log call and feeds real commit data back to the next turn', async () => {
      initRepo();
      fs.writeFileSync(path.join(workspaceDir, 'a.txt'), 'hello');
      execSync('git add a.txt', { cwd: workspaceDir });
      execSync('git commit -q -m "add a.txt"', { cwd: workspaceDir });
      db.setSetting('anthropic-key', 'test-key');

      anthropicStreamMock
        .mockReturnValueOnce(
          anthropicAgentStream([], { content: [{ type: 'tool_use', id: 'call_1', name: 'git_log', input: {} }] }),
        )
        .mockReturnValueOnce(anthropicAgentStream([], { content: [{ type: 'text', text: 'One commit found.' }] }));

      const toolCalls: AgentToolCallEvent[] = [];
      let done = false;
      await service.agentQuery('anthropic', 'model', 'what commits are there?', { workspacePath: workspaceDir, mode: 'repo' }, {
        onChunk: () => {},
        onToolCall: (info) => toolCalls.push(info),
        onWorkingSetUpdate: () => {},
        onApprovalRequest: () => {},
        onError: (message) => errors.push(message),
        onDone: () => { done = true; },
      });

      expect(done).toBe(true);
      expect(errors).toEqual([]);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe('git_log');
      expect(toolCalls[0].resultSummary).toContain('add a.txt');
    });
  });

  describe('completeInline', () => {
    const request = (overrides: Partial<{ provider: string; model: string; prefix: string; suffix: string; language: string }> = {}) => ({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      prefix: 'function add(a, b) {\n  return ',
      suffix: '\n}',
      language: 'javascript',
      ...overrides,
    });

    it('returns an empty string for a missing API key, without any network call', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.completeInline(request());

      expect(result).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(geminiStreamMock).not.toHaveBeenCalled();
    });

    it('buffers streamed chunks into a single returned string, not pushed anywhere', async () => {
      db.setSetting('gemini-key', 'test-key');
      geminiStreamMock.mockResolvedValue(toAsyncIterable([{ text: 'a + b;' }]));

      const result = await service.completeInline(request());

      expect(result).toBe('a + b;');
    });

    it('sends a fill-in-the-middle prompt with prefix/suffix, not the chat persona/rules/memory framing', async () => {
      db.run("INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES ('r1', 'p1', 'Always write tests', 1)");
      db.setSetting('gemini-key', 'test-key');
      geminiStreamMock.mockResolvedValue(toAsyncIterable([]));

      await service.completeInline(request());

      expect(geminiStreamMock).toHaveBeenCalledTimes(1);
      const call = geminiStreamMock.mock.calls[0][0];
      expect(call.contents as string).toContain('function add(a, b) {');
      expect(call.contents as string).not.toContain('You are SDE Code AI');
      expect(call.contents as string).not.toContain('Always write tests');
      expect(call.config.maxOutputTokens).toBe(256);
      expect(call.config.temperature).toBe(0.2);
    });

    it('a new completion call cancels only the previous completion, not an in-flight chat query', async () => {
      db.setSetting('gemini-key', 'test-key');
      let chatAborted = false;
      // First call: chat's stream, hangs until its own signal aborts.
      geminiStreamMock.mockImplementationOnce((params: { config?: { abortSignal?: AbortSignal } }) => {
        params.config?.abortSignal?.addEventListener('abort', () => {
          chatAborted = true;
        });
        return Promise.resolve(hangingUntilAborted(params.config?.abortSignal));
      });
      // Second call: the completion's own independent stream, resolves normally.
      geminiStreamMock.mockResolvedValueOnce(toAsyncIterable([{ text: 'x' }]));

      const chatPromise = service.query('gemini', 'model', 'hi', {}, sink());
      const completionResult = await service.completeInline(request());

      expect(chatAborted).toBe(false);
      expect(completionResult).toBe('x');

      service.abort();
      await chatPromise;
    });

    it('a failed provider request resolves to an empty string instead of throwing', async () => {
      db.setSetting('gemini-key', 'test-key');
      geminiStreamMock.mockRejectedValue(Object.assign(new Error('server error'), { name: 'ApiError', status: 500 }));

      const result = await service.completeInline(request());

      expect(result).toBe('');
    });
  });

  describe('testConnection', () => {
    it.each(['gemini', 'openai', 'anthropic', 'custom-openai'])('reports missing credentials for %s without any network call', async (provider) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.testConnection(provider);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/missing/i);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(geminiGenerateMock).not.toHaveBeenCalled();
      expect(anthropicCreateMock).not.toHaveBeenCalled();
    });

    it('reports success for Gemini when generateContent resolves', async () => {
      db.setSetting('gemini-key', 'test-key');
      geminiGenerateMock.mockResolvedValue({ text: 'pong' });

      const result = await service.testConnection('gemini');

      expect(result).toEqual({ success: true, message: 'Connected successfully.' });
      expect(geminiGenerateMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-1.5-flash' }),
      );
    });

    it('reports failure for Gemini when generateContent rejects, surfacing the SDK error message', async () => {
      db.setSetting('gemini-key', 'bad-key');
      geminiGenerateMock.mockRejectedValue(new Error('API key not valid'));

      const result = await service.testConnection('gemini');

      expect(result).toEqual({ success: false, message: 'API key not valid' });
    });

    it('reports success for Anthropic when messages.create resolves', async () => {
      db.setSetting('anthropic-key', 'test-key');
      anthropicCreateMock.mockResolvedValue({ id: 'msg_1' });

      const result = await service.testConnection('anthropic');

      expect(result).toEqual({ success: true, message: 'Connected successfully.' });
      expect(anthropicCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-3-haiku-20240307', max_tokens: 1 }),
      );
    });

    it('reports failure for Anthropic when messages.create rejects', async () => {
      db.setSetting('anthropic-key', 'bad-key');
      anthropicCreateMock.mockRejectedValue(new Error('invalid x-api-key'));

      const result = await service.testConnection('anthropic');

      expect(result).toEqual({ success: false, message: 'invalid x-api-key' });
    });

    it('reports success for OpenAI when the ping request returns ok', async () => {
      db.setSetting('openai-key', 'test-key');
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.testConnection('openai');

      expect(result).toEqual({ success: true, message: 'Connected successfully.' });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(JSON.parse(init.body)).toMatchObject({ model: 'gpt-4o-mini', stream: false });
    });

    it('reports a status-coded failure for OpenAI when the ping request returns non-ok', async () => {
      db.setSetting('openai-key', 'bad-key');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '{"error":"invalid_api_key"}' }));

      const result = await service.testConnection('openai');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/HTTP 401/);
      expect(result.message).toMatch(/invalid_api_key/);
    });

    it('defaults to the local Ollama URL and omits the Authorization header when none is configured', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.testConnection('ollama');

      expect(result.success).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:11434/v1/chat/completions');
      expect(init.headers.Authorization).toBeUndefined();
    });

    it('reports a network-level failure (e.g. server not running) distinctly from an HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED')));

      const result = await service.testConnection('lm-studio');

      expect(result).toEqual({ success: false, message: 'fetch failed: ECONNREFUSED' });
    });

    it('uses the saved custom-openai URL and key together', async () => {
      db.setSetting('custom-openai-url', 'https://my-endpoint.example/v1/chat/completions');
      db.setSetting('custom-openai-key', 'custom-key');
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.testConnection('custom-openai');

      expect(result.success).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://my-endpoint.example/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer custom-key');
    });

    it('reports an error for an unsupported provider, without any network call', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.testConnection('not-a-real-provider');

      expect(result).toEqual({ success: false, message: 'Unsupported AI provider: not-a-real-provider' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
