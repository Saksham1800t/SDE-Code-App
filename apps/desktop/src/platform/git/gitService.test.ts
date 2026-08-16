import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { GitService } from './gitService';
import { FakeLogService } from '../log';

describe('GitService', () => {
  let tmpDir: string;
  let log: FakeLogService;
  let git: GitService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-git-test-'));
    log = new FakeLogService();
    git = new GitService(log);
  });

  afterEach(() => {
    // On Windows, a git subprocess (especially two spawned concurrently via
    // Promise.all, e.g. getCommitFiles' numstat + name-status calls) can
    // hold — or have Windows Defender briefly re-lock — a handle on tmpDir
    // after exiting, racing this cleanup with an EBUSY that fs.rmSync's own
    // retry option didn't reliably clear even at 6x200ms. This is OS-level
    // cleanup noise, not a test failure: swallow it (the OS temp directory
    // is reclaimed eventually regardless) rather than failing the test that
    // already passed its real assertions.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (err) {
      console.warn(`Failed to clean up test tmpDir ${tmpDir} (non-fatal):`, err);
    }
  });

  it('isRepo is false for a plain directory, true after initRepo', async () => {
    expect(await git.isRepo(tmpDir)).toBe(false);

    await git.initRepo(tmpDir);

    expect(await git.isRepo(tmpDir)).toBe(true);
  });

  it('isRepo returns false (not throw) for a nonexistent path', async () => {
    expect(await git.isRepo(path.join(tmpDir, 'does-not-exist'))).toBe(false);
  });

  it('getStatus reports an untracked file', async () => {
    await git.initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');

    const status = await git.getStatus(tmpDir);

    expect(status.isRepo).toBe(true);
    expect(status.files).toHaveLength(1);
    expect(status.files[0]).toMatchObject({ relativePath: 'a.txt', statusText: 'Untracked', isStaged: false });
  });

  it('stageFile moves a file from unstaged to staged', async () => {
    await git.initRepo(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');

    await git.stageFile(tmpDir, 'a.txt');
    const status = await git.getStatus(tmpDir);

    expect(status.files[0].isStaged).toBe(true);
  });

  it('commit records history visible through getLog', async () => {
    await git.initRepo(tmpDir);
    // Configure a commit identity scoped to this repo so the commit succeeds
    // in CI environments with no global git user configured.
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'initial commit');

    const entries = await git.getLog(tmpDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('initial commit');
  });

  it('getFileCommitHistory returns only commits that touched the given file, most recent first', async () => {
    await git.initRepo(tmpDir);
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a1');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a and b');

    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b2');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'update b only');

    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a2');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'update a again');

    const entries = await git.getFileCommitHistory(tmpDir, 'a.txt');

    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('update a again');
    expect(entries[1].message).toBe('add a and b');
  });

  it('getFileCommitHistory follows renames so history survives a `git mv`', async () => {
    await git.initRepo(tmpDir);
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, 'old-name.txt'), 'content');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'create old-name.txt');

    execSync('git mv old-name.txt new-name.txt', { cwd: tmpDir });
    execSync('git commit -m "rename to new-name.txt"', { cwd: tmpDir });

    const entries = await git.getFileCommitHistory(tmpDir, 'new-name.txt');

    expect(entries.map((e) => e.message)).toEqual(['rename to new-name.txt', 'create old-name.txt']);
  });

  it('getFileCommitHistory returns an empty array (not an error) for a path with no history', async () => {
    await git.initRepo(tmpDir);
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'initial commit');

    const entries = await git.getFileCommitHistory(tmpDir, 'never-existed.txt');

    expect(entries).toEqual([]);
  });

  it('logs and rethrows when a real git operation fails', async () => {
    // Not a repo at all — commit must fail, and the failure should be logged.
    await expect(git.commit(tmpDir, 'nope')).rejects.toThrow();
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('Failed to commit changes:');
  });

  it('getMergeStatus reports no in-progress operation for a fresh repo', async () => {
    await git.initRepo(tmpDir);
    expect(await git.getMergeStatus(tmpDir)).toEqual({
      isMerging: false,
      isRebasing: false,
      isCherryPicking: false,
    });
  });

  function configureIdentity() {
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
  }

  it('getCommitDetails returns commit metadata and a file stat summary for a real hash', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const details = await git.getCommitDetails(tmpDir, hash);

    expect(details).toContain('add a.txt');
    expect(details).toContain('a.txt');
    expect(details).toContain('Test');
  });

  it('getCommitDetails returns empty string and logs an error for a nonexistent hash', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');

    const details = await git.getCommitDetails(tmpDir, 'deadbeef');

    expect(details).toBe('');
    expect(log.errors).toHaveLength(1);
  });

  it('getBlame attributes each line of a tracked file to the commit that introduced it', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');

    const blame = await git.getBlame(tmpDir, 'a.txt');

    expect(blame).toContain('line one');
    expect(blame).toContain('line two');
    expect(blame).toContain('Test');
  });

  it('getBlame returns empty string and logs an error for an untracked path', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');

    const blame = await git.getBlame(tmpDir, 'does-not-exist.txt');

    expect(blame).toBe('');
    expect(log.errors).toHaveLength(1);
  });

  it('searchCommits (message mode) finds a commit by a case-insensitive substring of its message', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'Fix the login bug');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'Add a README');

    const results = await git.searchCommits(tmpDir, 'login bug', 'message');

    expect(results).toHaveLength(1);
    expect(results[0].message).toBe('Fix the login bug');
  });

  it('searchCommits (content mode) finds the commit that introduced a specific string via pickaxe search', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'const MAX_RETRIES = 3;\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add retry constant');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'unrelated content\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'unrelated commit');

    const results = await git.searchCommits(tmpDir, 'MAX_RETRIES', 'content');

    expect(results).toHaveLength(1);
    expect(results[0].message).toBe('add retry constant');
  });

  it('searchCommits returns an empty array (not an error) when nothing matches', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'initial commit');

    const results = await git.searchCommits(tmpDir, 'nonexistent-pattern-xyz', 'message');

    expect(results).toEqual([]);
    expect(log.errors).toHaveLength(0);
  });

  it('getRepoStats resolves (does not hang) for a real repo with zero commits', async () => {
    // Regression test for a real bug: `git shortlog -sn --all` on a repo
    // with no commits falls back to reading commit-log text from stdin and
    // simple-git never closes that pipe, so the call hangs forever instead
    // of throwing. getRepoStats must skip it structurally when there are no
    // commits, not just wrap it in try/catch. Resolving at all (within
    // vitest's default per-test timeout) is the actual assertion here.
    await git.initRepo(tmpDir);
    configureIdentity();

    const stats = await git.getRepoStats(tmpDir);

    expect(stats).toEqual({
      commitCount: 0,
      branchCount: 0,
      contributorCount: 0,
      tagCount: 0,
      latestTag: null,
      latestCommit: null,
    });
  });

  it('getRepoStats returns the all-zero shape (not an error) for a non-repo directory', async () => {
    const stats = await git.getRepoStats(tmpDir);

    expect(stats).toEqual({
      commitCount: 0,
      branchCount: 0,
      contributorCount: 0,
      tagCount: 0,
      latestTag: null,
      latestCommit: null,
    });
  });

  it('getRepoStats reports real counts for a populated repo with commits and a tag', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'first commit');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'second commit');
    execSync('git tag v1.0.0', { cwd: tmpDir });

    const stats = await git.getRepoStats(tmpDir);

    expect(stats.commitCount).toBe(2);
    expect(stats.branchCount).toBe(1);
    expect(stats.contributorCount).toBe(1);
    expect(stats.tagCount).toBe(1);
    expect(stats.latestTag).toBe('v1.0.0');
    expect(stats.latestCommit?.message).toBe('second commit');
  });

  it('getCommitFiles reports every file as Added for the repo\'s root commit (no parent)', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'root commit');
    const [{ hash }] = await git.getLog(tmpDir);

    const files = await git.getCommitFiles(tmpDir, hash);

    expect(files).toHaveLength(2);
    expect(files.every((f) => f.statusText === 'Added')).toBe(true);
    expect(files.find((f) => f.path === 'a.txt')?.insertions).toBe(1);
  });

  it('getCommitFiles reports Modified with real insertion/deletion counts for an edited file', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line1\nline2\nline3\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line1\nCHANGED\nline3\nline4\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const files = await git.getCommitFiles(tmpDir, hash);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'a.txt', statusText: 'Modified', insertions: 2, deletions: 1 });
  });

  it('getCommitFiles reports Deleted for a removed file', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    execSync('git rm a.txt', { cwd: tmpDir });
    await git.commit(tmpDir, 'remove a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const files = await git.getCommitFiles(tmpDir, hash);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('a.txt');
    expect(files[0].statusText).toBe('Deleted');
  });

  it('getCommitFiles reports Renamed with fromPath and real counts for a rename with content changes (partial similarity)', async () => {
    // A plain `git mv` with no content change is a 100%-similarity rename —
    // the easy case. This test exercises the harder path: renaming AND
    // editing content in the same commit produces a partial-similarity (not
    // R100) record, which is exactly the shape a naive parser of --numstat's
    // human-readable "dir/{old => new}" abbreviation would corrupt. Regression
    // test for that bug, verified against this repo's own real history
    // (commit fe09c29) during planning.
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'old.txt'), 'line1\nline2\nline3\nline4\nline5\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add old.txt');
    execSync('git mv old.txt new.txt', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'line1\nline2\nline3\nCHANGED\nEXTRA\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'rename and edit');
    const [{ hash }] = await git.getLog(tmpDir);

    const files = await git.getCommitFiles(tmpDir, hash);

    expect(files).toHaveLength(1);
    expect(files[0].statusText).toBe('Renamed');
    expect(files[0].path).toBe('new.txt');
    expect(files[0].fromPath).toBe('old.txt');
    expect(files[0].insertions).toBeGreaterThan(0);
    expect(files[0].deletions).toBeGreaterThan(0);
  });

  it('getCommitFiles reports zero insertions/deletions for a binary file', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'image.bin'), Buffer.from([0, 1, 2, 3, 255, 254]));
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add binary file');
    const [{ hash }] = await git.getLog(tmpDir);

    const files = await git.getCommitFiles(tmpDir, hash);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'image.bin', statusText: 'Added', insertions: 0, deletions: 0 });
  });

  it('getCommitFiles returns an empty array (not an error) for a nonexistent hash', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'initial commit');

    const files = await git.getCommitFiles(tmpDir, 'deadbeef');

    expect(files).toEqual([]);
    expect(log.errors).toHaveLength(1);
  });

  it('getCommitFileDiff returns empty original content for a file added in that commit', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const diff = await git.getCommitFileDiff(tmpDir, hash, 'a.txt');

    expect(diff.original).toBe('');
    expect(diff.modified).toBe('hello\n');
  });

  it('getCommitFileDiff returns empty modified content for a file deleted in that commit', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    execSync('git rm a.txt', { cwd: tmpDir });
    await git.commit(tmpDir, 'remove a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const diff = await git.getCommitFileDiff(tmpDir, hash, 'a.txt');

    expect(diff.original).toBe('hello\n');
    expect(diff.modified).toBe('');
  });

  it('getCommitFileDiff returns both sides for a plain modification', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'old content\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'new content\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const diff = await git.getCommitFileDiff(tmpDir, hash, 'a.txt');

    expect(diff.original).toBe('old content\n');
    expect(diff.modified).toBe('new content\n');
  });

  it('getFileHotspots ranks files by change count, most-changed first', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '1');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), '1');
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), '1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add all three files');

    // a.txt changes 2 more times, c.txt changes 1 more time, b.txt never again
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '2');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit a.txt again');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '3');
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), '2');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit a.txt and c.txt');

    const hotspots = await git.getFileHotspots(tmpDir);

    expect(hotspots.map((h) => h.path)).toEqual(['a.txt', 'c.txt', 'b.txt']);
    expect(hotspots[0].changeCount).toBe(3);
    expect(hotspots[1].changeCount).toBe(2);
    expect(hotspots[2].changeCount).toBe(1);
  });

  it('getFileHotspots truncates to fileLimit', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) {
      fs.writeFileSync(path.join(tmpDir, name), '1');
    }
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add five files');

    const hotspots = await git.getFileHotspots(tmpDir, 1000, 2);

    expect(hotspots).toHaveLength(2);
  });

  it('getFileHotspots only walks the most recent commitLimit commits', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'old.txt'), '1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'commit 1 (outside the window)');
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), '1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'commit 2');
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), '2');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'commit 3');

    const hotspots = await git.getFileHotspots(tmpDir, 2, 50);

    expect(hotspots.find((h) => h.path === 'old.txt')).toBeUndefined();
    expect(hotspots.find((h) => h.path === 'new.txt')?.changeCount).toBe(2);
  });

  it('getFileHotspots returns an empty array (not an error) for a non-repo directory', async () => {
    const hotspots = await git.getFileHotspots(tmpDir);
    expect(hotspots).toEqual([]);
  });

  it('getFileHotspots (documented limitation) counts a renamed file under two separate path entries, not unified', async () => {
    // Same rename-with-content-change setup used to regression-guard
    // getCommitFiles' numstat parsing. Here it documents a different,
    // known characteristic: git log --name-only credits a rename commit
    // only under the NEW path, so the file's pre-rename history sits under
    // a separate string key from its post-rename history. This test locks
    // in that documented behavior rather than leaving it an untested
    // assumption.
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'old.txt'), 'line1\nline2\nline3\nline4\nline5\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add old.txt');
    execSync('git mv old.txt new.txt', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'line1\nline2\nline3\nCHANGED\nEXTRA\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'rename and edit');

    const hotspots = await git.getFileHotspots(tmpDir);

    const oldEntry = hotspots.find((h) => h.path === 'old.txt');
    const newEntry = hotspots.find((h) => h.path === 'new.txt');
    expect(oldEntry?.changeCount).toBe(1); // only the original "add old.txt" commit
    expect(newEntry?.changeCount).toBe(1); // only the rename commit — old.txt's history isn't carried over
  });

  it('getCommitPatch includes the diff hunk for a commit, not just stats', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'old content\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'new content\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit a.txt');
    const [{ hash }] = await git.getLog(tmpDir);

    const patch = await git.getCommitPatch(tmpDir, hash);

    expect(patch).toContain('edit a.txt');
    expect(patch).toContain('-old content');
    expect(patch).toContain('+new content');
  });

  it('getCommitPatch returns an empty string (not an error) for a nonexistent hash', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');

    const patch = await git.getCommitPatch(tmpDir, '0000000000000000000000000000000000000000');

    expect(patch).toBe('');
  });

  it('getBranchDiff reports files that differ between two branches with correct status and counts', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'shared.txt'), 'line1\nline2\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'initial commit on main');
    const [{ hash: baseHash }] = await git.getLog(tmpDir);
    const { current: baseBranch } = await git.getBranches(tmpDir);

    await git.createBranch(tmpDir, 'feature', baseHash);
    fs.writeFileSync(path.join(tmpDir, 'shared.txt'), 'line1\nline2\nline3\n');
    fs.writeFileSync(path.join(tmpDir, 'new-on-feature.txt'), 'brand new\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit shared.txt and add a new file on feature');

    const diff = await git.getBranchDiff(tmpDir, baseBranch, 'feature');

    const sharedEntry = diff.find((f) => f.path === 'shared.txt');
    const newEntry = diff.find((f) => f.path === 'new-on-feature.txt');
    expect(sharedEntry).toMatchObject({ statusText: 'Modified', insertions: 1, deletions: 0 });
    expect(newEntry).toMatchObject({ statusText: 'Added', insertions: 1, deletions: 0 });
  });

  it('getBranchDiff returns an empty array for two branches with no differences', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    const [{ hash: baseHash }] = await git.getLog(tmpDir);
    const { current: baseBranch } = await git.getBranches(tmpDir);
    await git.createBranch(tmpDir, 'feature', baseHash);

    const diff = await git.getBranchDiff(tmpDir, baseBranch, 'feature');

    expect(diff).toEqual([]);
  });

  it('getBranchDiff returns an empty array (not an error) for a nonexistent branch', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt');
    const { current: baseBranch } = await git.getBranches(tmpDir);

    const diff = await git.getBranchDiff(tmpDir, baseBranch, 'does-not-exist');

    expect(diff).toEqual([]);
  });

  it('getBranchFileDiff returns both sides for a file that differs between two branches', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'on base branch\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt on base branch');
    const [{ hash: baseHash }] = await git.getLog(tmpDir);
    const { current: baseBranch } = await git.getBranches(tmpDir);

    await git.createBranch(tmpDir, 'feature', baseHash);
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'on feature\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'edit a.txt on feature');

    const diff = await git.getBranchFileDiff(tmpDir, baseBranch, 'feature', 'a.txt');

    expect(diff.original).toBe('on base branch\n');
    expect(diff.modified).toBe('on feature\n');
  });

  it('getBranchFileDiff returns empty original content for a file that only exists on the second branch', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'base\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add a.txt on base branch');
    const [{ hash: baseHash }] = await git.getLog(tmpDir);
    const { current: baseBranch } = await git.getBranches(tmpDir);

    await git.createBranch(tmpDir, 'feature', baseHash);
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'only on feature\n');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'add new.txt on feature');

    const diff = await git.getBranchFileDiff(tmpDir, baseBranch, 'feature', 'new.txt');

    expect(diff.original).toBe('');
    expect(diff.modified).toBe('only on feature\n');
  });

  it('getCommitGraph reports a root commit with no parents and later commits with exactly one parent', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'first commit');
    const [{ hash: firstHash }] = await git.getLog(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '2');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'second commit');
    const [{ hash: secondHash }] = await git.getLog(tmpDir);

    const graph = await git.getCommitGraph(tmpDir);

    const first = graph.find((c) => c.hash === firstHash);
    const second = graph.find((c) => c.hash === secondHash);
    expect(first?.parents).toEqual([]);
    expect(second?.parents).toEqual([firstHash]);
  });

  it('getCommitGraph reports two parents for a merge commit', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'base.txt'), 'base');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'base commit');
    const [{ hash: baseHash }] = await git.getLog(tmpDir);
    const { current: baseBranch } = await git.getBranches(tmpDir);

    await git.createBranch(tmpDir, 'feature', baseHash);
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'on feature');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'commit on feature');
    const [{ hash: featureHash }] = await git.getLog(tmpDir);

    await git.checkoutBranch(tmpDir, baseBranch);
    fs.writeFileSync(path.join(tmpDir, 'base2.txt'), 'more on base');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'second commit on base');
    const [{ hash: base2Hash }] = await git.getLog(tmpDir);

    execSync('git merge feature -m "merge feature into base"', { cwd: tmpDir });
    const graph = await git.getCommitGraph(tmpDir);
    // Commits created in rapid succession within a test can share the same
    // second-resolution git timestamp, so `git log --all`'s default
    // (date-based) ordering doesn't guarantee the merge commit sorts to
    // index 0 — find it by its distinguishing two-parent shape instead.
    const merge = graph.find((c) => c.parents.length === 2)!;

    expect(merge.message).toBe('merge feature into base');
    expect(merge.parents).toHaveLength(2);
    expect(merge.parents).toContain(base2Hash);
    expect(merge.parents).toContain(featureHash);
  });

  it('getCommitGraph includes commits from other branches via --all, not just the current branch', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), '1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'base commit');
    const [{ hash: baseHash }] = await git.getLog(tmpDir);
    const { current: baseBranch } = await git.getBranches(tmpDir);

    await git.createBranch(tmpDir, 'feature', baseHash);
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), '1');
    await git.stageAll(tmpDir);
    await git.commit(tmpDir, 'commit only on feature');
    await git.checkoutBranch(tmpDir, baseBranch);

    const graph = await git.getCommitGraph(tmpDir);

    expect(graph.some((c) => c.message === 'commit only on feature')).toBe(true);
  });

  it('getCommitGraph paginates via skip without overlapping or dropping commits', async () => {
    await git.initRepo(tmpDir);
    configureIdentity();
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), String(i));
      await git.stageAll(tmpDir);
      await git.commit(tmpDir, `commit ${i}`);
    }

    const page1 = await git.getCommitGraph(tmpDir, 2, 0);
    const page2 = await git.getCommitGraph(tmpDir, 2, 2);

    expect(page1.map((c) => c.message)).toEqual(['commit 4', 'commit 3']);
    expect(page2.map((c) => c.message)).toEqual(['commit 2', 'commit 1']);
  });

  it('getCommitGraph returns an empty array (not an error) for a non-repo directory', async () => {
    const graph = await git.getCommitGraph(tmpDir);
    expect(graph).toEqual([]);
  });

  it('discoverRepos finds the root itself when it is a repo with no nested repos', async () => {
    await git.initRepo(tmpDir);

    const repos = await git.discoverRepos(tmpDir);

    expect(repos).toEqual([{ path: tmpDir, name: path.basename(tmpDir) }]);
  });

  it('discoverRepos finds sibling nested repos as separate entries, without descending into a repo it already found', async () => {
    // Root itself is NOT a repo, but contains two independent nested repos.
    const repoA = path.join(tmpDir, 'project-a');
    const repoB = path.join(tmpDir, 'project-b');
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    await git.initRepo(repoA);
    await git.initRepo(repoB);
    // A file inside repoA's working tree that happens to look like it could
    // contain a repo — confirms discoverRepos doesn't re-scan inside a repo
    // it already identified.
    fs.mkdirSync(path.join(repoA, 'vendor', 'nested-repo'), { recursive: true });

    const repos = await git.discoverRepos(tmpDir);

    expect(repos).toHaveLength(2);
    expect(repos).toContainEqual({ path: repoA, name: 'project-a' });
    expect(repos).toContainEqual({ path: repoB, name: 'project-b' });
  });

  it('discoverRepos does not descend into node_modules or other ignored directories', async () => {
    const fakeRepoInNodeModules = path.join(tmpDir, 'node_modules', 'some-package');
    fs.mkdirSync(fakeRepoInNodeModules, { recursive: true });
    await git.initRepo(fakeRepoInNodeModules);
    const realRepo = path.join(tmpDir, 'app');
    fs.mkdirSync(realRepo, { recursive: true });
    await git.initRepo(realRepo);

    const repos = await git.discoverRepos(tmpDir);

    expect(repos).toEqual([{ path: realRepo, name: 'app' }]);
  });

  it('discoverRepos respects the scan depth bound', async () => {
    // MAX_SCAN_DEPTH is 3 — a repo 4 levels deep should not be found.
    const tooDeep = path.join(tmpDir, 'a', 'b', 'c', 'd');
    fs.mkdirSync(tooDeep, { recursive: true });
    await git.initRepo(tooDeep);

    const repos = await git.discoverRepos(tmpDir);

    expect(repos).toEqual([]);
  });

  it('discoverRepos returns an empty array for a directory tree with no repos', async () => {
    fs.mkdirSync(path.join(tmpDir, 'plain-folder'), { recursive: true });

    const repos = await git.discoverRepos(tmpDir);

    expect(repos).toEqual([]);
  });

  describe('getWorkingTreeDiff / applyWorkingTreeDiff (Phase 29 — Edit Sessions)', () => {
    async function initWithCommit(dir: string) {
      await git.initRepo(dir);
      execSync('git config user.email "test@example.com"', { cwd: dir });
      execSync('git config user.name "Test"', { cwd: dir });
      fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\nline two\n');
      await git.stageAll(dir);
      await git.commit(dir, 'initial commit');
    }

    it('returns an empty string for a clean working tree', async () => {
      await initWithCommit(tmpDir);
      expect(await git.getWorkingTreeDiff(tmpDir)).toBe('');
    });

    it('returns an empty string (not an error) for a brand-new repo with no commits yet', async () => {
      await git.initRepo(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
      expect(await git.getWorkingTreeDiff(tmpDir)).toBe('');
    });

    it('includes unstaged changes to a tracked file', async () => {
      await initWithCommit(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two CHANGED\n');

      const diff = await git.getWorkingTreeDiff(tmpDir);

      expect(diff).toContain('a.txt');
      expect(diff).toContain('CHANGED');
    });

    it('includes staged changes alongside unstaged ones in a single diff', async () => {
      await initWithCommit(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one STAGED\nline two\n');
      await git.stageAll(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one STAGED\nline two UNSTAGED\n');

      const diff = await git.getWorkingTreeDiff(tmpDir);

      expect(diff).toContain('STAGED');
      expect(diff).toContain('UNSTAGED');
    });

    it('applyWorkingTreeDiff round-trips: capturing then re-applying the same diff restores the change', async () => {
      await initWithCommit(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two CHANGED\n');
      const diff = await git.getWorkingTreeDiff(tmpDir);

      // Revert to the clean commit, then re-apply the captured diff. Read
      // back via a CRLF-normalizing helper — Windows git's core.autocrlf
      // rewrites LF to CRLF on checkout, which is a platform/git-config
      // artifact of the test's own revert step, not something
      // applyWorkingTreeDiff should be judged against.
      const readNormalized = () => fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8').replace(/\r\n/g, '\n');
      execSync('git checkout -- a.txt', { cwd: tmpDir });
      expect(readNormalized()).toBe('line one\nline two\n');

      const applied = await git.applyWorkingTreeDiff(tmpDir, diff);

      expect(applied).toBe(true);
      expect(readNormalized()).toBe('line one\nline two CHANGED\n');
    });

    it('applyWorkingTreeDiff returns false (not a throw) for a diff that no longer applies cleanly', async () => {
      await initWithCommit(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two CHANGED\n');
      const diff = await git.getWorkingTreeDiff(tmpDir);

      // Revert, then make a conflicting local edit to the same line before re-applying.
      execSync('git checkout -- a.txt', { cwd: tmpDir });
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two DIVERGED DIFFERENTLY\n');

      const applied = await git.applyWorkingTreeDiff(tmpDir, diff);

      expect(applied).toBe(false);
    });

    it('applyWorkingTreeDiff returns false for empty diff text without touching the working tree', async () => {
      await initWithCommit(tmpDir);
      expect(await git.applyWorkingTreeDiff(tmpDir, '')).toBe(false);
    });
  });

  describe('createWorktree / removeWorktree (Parallel Agent Threads isolation)', () => {
    beforeEach(async () => {
      await git.initRepo(tmpDir);
      execSync('git config user.email "test@example.com"', { cwd: tmpDir });
      execSync('git config user.name "Test"', { cwd: tmpDir });
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
      await git.stageAll(tmpDir);
      await git.commit(tmpDir, 'initial commit');
    });

    it('creates an isolated checkout on a new branch, outside the main repo directory', async () => {
      const worktreePath = await git.createWorktree(tmpDir, 'thread-branch-1');

      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, 'a.txt'))).toBe(true);
      expect(path.resolve(worktreePath).startsWith(path.resolve(tmpDir))).toBe(false);

      const branches = await git.getBranches(tmpDir);
      expect(branches.local).toContain('thread-branch-1');
    });

    it('a file written in the worktree does not appear in the main repo\'s status, and vice versa', async () => {
      const worktreePath = await git.createWorktree(tmpDir, 'thread-branch-2');
      fs.writeFileSync(path.join(worktreePath, 'only-in-worktree.txt'), 'x');
      fs.writeFileSync(path.join(tmpDir, 'only-in-main.txt'), 'y');

      const mainStatus = await git.getStatus(tmpDir);
      const worktreeStatus = await git.getStatus(worktreePath);

      expect(mainStatus.files.map((f) => f.relativePath)).toEqual(['only-in-main.txt']);
      expect(worktreeStatus.files.map((f) => f.relativePath)).toEqual(['only-in-worktree.txt']);
    });

    it('removeWorktree deletes the checkout directory and the branch is no longer checked out there', async () => {
      const worktreePath = await git.createWorktree(tmpDir, 'thread-branch-3');
      expect(fs.existsSync(worktreePath)).toBe(true);

      await git.removeWorktree(tmpDir, worktreePath);

      expect(fs.existsSync(worktreePath)).toBe(false);
    });
  });
});
