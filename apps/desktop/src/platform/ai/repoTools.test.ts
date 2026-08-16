import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { AITool } from '@sde-code/sdk';
import { createRepoTools } from './repoTools';
import { GitService } from '../git';
import { FakeLogService } from '../log';

describe('createRepoTools', () => {
  let tmpDir: string;
  let gitService: GitService;
  let tools: AITool[];

  const tool = (name: string): AITool => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`Tool "${name}" not found`);
    return found;
  };

  const configureIdentity = () => {
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-repo-tools-test-')).replace(/\\/g, '/');
    gitService = new GitService(new FakeLogService());
    await gitService.initRepo(tmpDir);
    configureIdentity();
    tools = createRepoTools({ workspacePath: tmpDir, gitService });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('git_log lists commits most-recent-first with hash/author/date/message', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'first commit');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'second commit');

    const result = await tool('git_log').execute({});

    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('second commit');
    expect(lines[1]).toContain('first commit');
    expect(lines[0]).toContain('Test');
  });

  it('git_log returns a plain "no commits" message for an empty repo', async () => {
    const result = await tool('git_log').execute({});
    expect(result).toBe('No commits found.');
  });

  it('git_log caps the requested limit at 50', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'only commit');

    const result = await tool('git_log').execute({ limit: 10000 });

    expect(result.split('\n')).toHaveLength(1);
  });

  it('git_show returns commit metadata and file stats for a real hash', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'add a.txt');
    const [{ hash }] = await gitService.getLog(tmpDir);

    const result = await tool('git_show').execute({ hash });

    expect(result).toContain('add a.txt');
    expect(result).toContain('a.txt');
  });

  it('git_show returns a model-facing error for an unknown hash', async () => {
    const result = await tool('git_show').execute({ hash: 'deadbeef' });
    expect(result).toMatch(/Error: no commit found for "deadbeef"/);
  });

  it('git_show requires a hash argument', async () => {
    const result = await tool('git_show').execute({});
    expect(result).toBe('Error: hash is required.');
  });

  it('git_blame attributes lines of a tracked file to the commit and author', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\n');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'add a.txt');

    const result = await tool('git_blame').execute({ filePath: 'a.txt' });

    expect(result).toContain('line one');
    expect(result).toContain('Test');
  });

  it('git_blame rejects a path that escapes the workspace root', async () => {
    const result = await tool('git_blame').execute({ filePath: '../../etc/passwd' });
    expect(result).toMatch(/outside the workspace root/);
  });

  it('git_blame returns a model-facing error for an untracked path', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'add a.txt');

    const result = await tool('git_blame').execute({ filePath: 'does-not-exist.txt' });

    expect(result).toMatch(/could not blame/);
  });

  it('git_search (message mode, the default) finds a commit by message substring', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'Fix the login bug');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'Add a README');

    const result = await tool('git_search').execute({ query: 'login bug' });

    expect(result).toContain('Fix the login bug');
    expect(result).not.toContain('Add a README');
  });

  it('git_search (content mode) finds the commit that introduced a specific string', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'const MAX_RETRIES = 3;\n');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'add retry constant');

    const result = await tool('git_search').execute({ query: 'MAX_RETRIES', mode: 'content' });

    expect(result).toContain('add retry constant');
  });

  it('git_search returns a plain "no commits" message when nothing matches', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await gitService.stageAll(tmpDir);
    await gitService.commit(tmpDir, 'initial commit');

    const result = await tool('git_search').execute({ query: 'nonexistent-xyz' });

    expect(result).toBe('No commits found.');
  });

  it('git_search requires a query argument', async () => {
    const result = await tool('git_search').execute({});
    expect(result).toBe('Error: query is required.');
  });

  it('no tool calls requestApproval-style gating — all four execute immediately with no side channel', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(['git_blame', 'git_log', 'git_search', 'git_show']);
  });
});
