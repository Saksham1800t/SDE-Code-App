import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AITool } from '@sde-code/sdk';
import type { AgentFileChange } from '@sde-code/protocol';
import { createAgentTools, applyAgentToolPolicies } from './agentTools';
import type { RunCommandResult } from './agentTerminalRunner';
import { FileSystemService } from '../fs';
import { SearchService } from '../search';
import { FakeLogService } from '../log';

describe('createAgentTools', () => {
  let tmpDir: string;
  let workingSet: Map<string, AgentFileChange>;
  let tools: AITool[];
  let runCommandCalls: Array<{ command: string; cwd: string }>;
  let runCommandResult: RunCommandResult;

  const tool = (name: string): AITool => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`Tool "${name}" not found`);
    return found;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-agent-tools-test-')).replace(/\\/g, '/');
    workingSet = new Map();
    runCommandCalls = [];
    runCommandResult = { stdout: '', stderr: '', exitCode: 0 };
    const log = new FakeLogService();
    tools = createAgentTools({
      workspaceFolders: [tmpDir],
      fileSystemService: new FileSystemService(log),
      searchService: new SearchService(log),
      workingSet,
      signal: new AbortController().signal,
      runCommand: async (command, cwd) => {
        runCommandCalls.push({ command, cwd });
        return runCommandResult;
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('read_file returns real file contents resolved relative to the workspace root', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world');
    const result = await tool('read_file').execute({ filePath: 'a.txt' });
    expect(result).toBe('hello world');
  });

  it('read_file rejects a path that escapes the workspace root', async () => {
    const result = await tool('read_file').execute({ filePath: '../../etc/passwd' });
    expect(result).toMatch(/outside the workspace root/);
  });

  it('list_directory returns real entries with isDirectory flags', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    const result = await tool('list_directory').execute({ dirPath: '.' });
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(
      expect.arrayContaining([
        { name: 'a.txt', isDirectory: false },
        { name: 'sub', isDirectory: true },
      ]),
    );
  });

  it('search_files finds a real match via the shared SearchService', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const needle = 1;');
    const result = await tool('search_files').execute({ query: 'needle' });
    expect(result).toContain('a.ts:1');
  });

  it('propose_file_edit stages an edit without writing to disk, capturing originalContent once', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'original');

    await tool('propose_file_edit').execute({ filePath: 'a.txt', content: 'first edit' });
    await tool('propose_file_edit').execute({ filePath: 'a.txt', content: 'second edit' });

    expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf-8')).toBe('original');
    const key = `${tmpDir}/a.txt`;
    expect(workingSet.get(key)).toMatchObject({
      originalContent: 'original',
      proposedContent: 'second edit',
      isNew: false,
      isDeleted: false,
    });
  });

  it('propose_file_edit on a nonexistent file returns an error instead of staging', async () => {
    const result = await tool('propose_file_edit').execute({ filePath: 'missing.txt', content: 'x' });
    expect(result).toMatch(/does not exist/);
    expect(workingSet.size).toBe(0);
  });

  it('create_file stages a new file without touching disk', async () => {
    const result = await tool('create_file').execute({ filePath: 'new.txt', content: 'brand new' });
    expect(result).toMatch(/Staged creation/);
    expect(fs.existsSync(path.join(tmpDir, 'new.txt'))).toBe(false);
    expect(workingSet.get(`${tmpDir}/new.txt`)).toMatchObject({
      originalContent: '',
      proposedContent: 'brand new',
      isNew: true,
      isDeleted: false,
    });
  });

  it('create_file on an existing path returns an error and tells the model to use propose_file_edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'existing');
    const result = await tool('create_file').execute({ filePath: 'a.txt', content: 'x' });
    expect(result).toMatch(/already exists.*propose_file_edit/);
    expect(workingSet.size).toBe(0);
  });

  it('delete_file stages a deletion without calling fs.unlinkSync', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'bye');
    const result = await tool('delete_file').execute({ filePath: 'a.txt' });
    expect(result).toMatch(/Staged deletion/);
    expect(fs.existsSync(path.join(tmpDir, 'a.txt'))).toBe(true);
    expect(workingSet.get(`${tmpDir}/a.txt`)).toMatchObject({
      originalContent: 'bye',
      proposedContent: '',
      isNew: false,
      isDeleted: true,
    });
  });

  it('delete_file on a nonexistent file returns an error', async () => {
    const result = await tool('delete_file').execute({ filePath: 'missing.txt' });
    expect(result).toMatch(/does not exist/);
    expect(workingSet.size).toBe(0);
  });

  it('run_terminal_command executes and reports stdout/stderr/exit code (approval gating, if any, is applied by applyAgentToolPolicies — see below)', async () => {
    runCommandResult = { stdout: 'hi there', stderr: '', exitCode: 0 };

    const result = await tool('run_terminal_command').execute({ command: 'echo hi there' });

    expect(runCommandCalls).toEqual([{ command: 'echo hi there', cwd: tmpDir }]);
    expect(result).toContain('hi there');
    expect(result).toContain('exit code: 0');
  });

  it('run_terminal_command rejects an empty command without running it', async () => {
    const result = await tool('run_terminal_command').execute({ command: '   ' });

    expect(result).toMatch(/command is required/);
    expect(runCommandCalls).toEqual([]);
  });

  describe('multi-root workspaces', () => {
    let tmpDir2: string;
    let multiRootTools: AITool[];
    const multiRootTool = (name: string): AITool => {
      const found = multiRootTools.find((t) => t.name === name);
      if (!found) throw new Error(`Tool "${name}" not found`);
      return found;
    };

    beforeEach(() => {
      tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-agent-tools-test2-')).replace(/\\/g, '/');
      const log = new FakeLogService();
      multiRootTools = createAgentTools({
        workspaceFolders: [tmpDir, tmpDir2],
        fileSystemService: new FileSystemService(log),
        searchService: new SearchService(log),
        workingSet,
        signal: new AbortController().signal,
        runCommand: async (command, cwd) => {
          runCommandCalls.push({ command, cwd });
          return runCommandResult;
        },
      });
    });

    afterEach(() => {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    });

    it('read_file resolves an absolute path into the second folder, not just the first', async () => {
      fs.writeFileSync(path.join(tmpDir2, 'b.txt'), 'from the second folder');
      const result = await multiRootTool('read_file').execute({ filePath: `${tmpDir2}/b.txt` });
      expect(result).toBe('from the second folder');
    });

    it('read_file rejects an absolute path outside every open folder', async () => {
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-agent-tools-outside-'));
      const result = await multiRootTool('read_file').execute({ filePath: `${elsewhere.replace(/\\/g, '/')}/x.txt` });
      expect(result).toMatch(/outside the workspace root/);
      fs.rmSync(elsewhere, { recursive: true, force: true });
    });

    it('a bare relative path still resolves against the first (primary) folder', async () => {
      fs.writeFileSync(path.join(tmpDir, 'primary.txt'), 'primary folder content');
      const result = await multiRootTool('read_file').execute({ filePath: 'primary.txt' });
      expect(result).toBe('primary folder content');
    });

    it('run_terminal_command runs in the primary (first) folder', async () => {
      await multiRootTool('run_terminal_command').execute({ command: 'echo hi' });
      expect(runCommandCalls[runCommandCalls.length - 1].cwd).toBe(tmpDir);
    });

    it('search_files fans out across every folder, prefixing matches with their folder name', async () => {
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const needle = 1;');
      fs.writeFileSync(path.join(tmpDir2, 'b.ts'), 'const needle = 2;');

      const result = await multiRootTool('search_files').execute({ query: 'needle' });

      expect(result).toContain(`${path.basename(tmpDir)}/a.ts:1`);
      expect(result).toContain(`${path.basename(tmpDir2)}/b.ts:1`);
    });
  });
});

describe('applyAgentToolPolicies', () => {
  const makeTool = (name: string): AITool & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      name,
      description: 'test tool',
      parameters: { type: 'object', properties: {} },
      calls,
      async execute(args) {
        calls.push(args);
        return `${name} ran`;
      },
    };
  };

  it('a tool with no entry in the policy map (e.g. an extension tool) passes through completely unchanged', async () => {
    const t = makeTool('some_extension_tool');
    const [wrapped] = applyAgentToolPolicies([t], {}, async () => true);
    expect(wrapped).toBe(t); // same reference — not even re-wrapped
    expect(await wrapped.execute({})).toBe('some_extension_tool ran');
  });

  it('policy "allow" passes the tool through unchanged', async () => {
    const t = makeTool('read_file');
    const [wrapped] = applyAgentToolPolicies([t], { read_file: 'allow' }, async () => true);
    expect(wrapped).toBe(t);
  });

  it('policy "deny" removes the tool from the returned list entirely', () => {
    const t = makeTool('run_terminal_command');
    const result = applyAgentToolPolicies([t], { run_terminal_command: 'deny' }, async () => true);
    expect(result).toEqual([]);
  });

  it('policy "ask" blocks on the approval callback before executing, and runs the real tool when approved', async () => {
    const t = makeTool('run_terminal_command');
    const approvalCalls: Array<{ toolName: string; argsSummary: string }> = [];
    const [wrapped] = applyAgentToolPolicies([t], { run_terminal_command: 'ask' }, async (toolName, argsSummary) => {
      approvalCalls.push({ toolName, argsSummary });
      return true;
    });

    const result = await wrapped.execute({ command: 'echo hi' });

    expect(approvalCalls).toEqual([{ toolName: 'run_terminal_command', argsSummary: 'echo hi' }]);
    expect(t.calls).toEqual([{ command: 'echo hi' }]); // the real tool actually ran
    expect(result).toBe('run_terminal_command ran');
  });

  it('policy "ask" does not run the real tool when the approval callback denies it', async () => {
    const t = makeTool('delete_file');
    const [wrapped] = applyAgentToolPolicies([t], { delete_file: 'ask' }, async () => false);

    const result = await wrapped.execute({ filePath: 'important.ts' });

    expect(t.calls).toEqual([]); // never ran
    expect(result).toMatch(/denied/i);
    expect(result).toContain('delete_file');
  });

  it('summarizes read_file/propose_file_edit/create_file/delete_file args by filePath in the approval prompt', async () => {
    const t = makeTool('propose_file_edit');
    let seenSummary = '';
    const [wrapped] = applyAgentToolPolicies([t], { propose_file_edit: 'ask' }, async (_toolName, argsSummary) => {
      seenSummary = argsSummary;
      return true;
    });
    await wrapped.execute({ filePath: 'src/foo.ts', content: 'irrelevant huge content' });
    expect(seenSummary).toBe('src/foo.ts');
  });

  it('applies allow/ask/deny independently across a mixed multi-tool list', async () => {
    const allowed = makeTool('read_file');
    const asked = makeTool('run_terminal_command');
    const denied = makeTool('delete_file');
    const untouched = makeTool('some_extension_tool');

    const result = applyAgentToolPolicies(
      [allowed, asked, denied, untouched],
      { read_file: 'allow', run_terminal_command: 'ask', delete_file: 'deny' },
      async () => true,
    );

    expect(result.map((t) => t.name)).toEqual(['read_file', 'run_terminal_command', 'some_extension_tool']);
  });
});
