import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import type {
  GitFileEntry,
  GitStatusResult,
  GitBranchesResult,
  GitLogEntry,
  GitRemoteEntry,
  GitStashEntry,
  GitMergeStatus,
  GitDiffResult,
  GitRepoStats,
  GitCommitFileEntry,
  GitFileHotspot,
  GitGraphCommit,
  GitRepoRoot,
} from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';

// Re-exported so existing consumers don't need to know these types actually live in @sde-code/protocol now, the source of truth shared with the IPC contract.
export type {
  GitFileEntry,
  GitStatusResult,
  GitBranchesResult,
  GitLogEntry,
  GitRemoteEntry,
  GitStashEntry,
  GitMergeStatus,
  GitDiffResult,
  GitRepoStats,
  GitCommitFileEntry,
  GitFileHotspot,
  GitGraphCommit,
  GitRepoRoot,
};

export interface IGitService {
  isRepo(dir: string): Promise<boolean>;
  getStatus(dir: string): Promise<GitStatusResult>;
  initRepo(dir: string): Promise<boolean>;
  stageFile(dir: string, relativePath: string): Promise<void>;
  unstageFile(dir: string, relativePath: string): Promise<void>;
  stageAll(dir: string): Promise<void>;
  unstageAll(dir: string): Promise<void>;
  discardFile(dir: string, relativePath: string): Promise<void>;
  discardAll(dir: string): Promise<void>;
  commit(dir: string, message: string): Promise<void>;
  undoLastCommit(dir: string): Promise<void>;
  amendLastCommit(dir: string, message: string): Promise<void>;
  push(dir: string): Promise<void>;
  pull(dir: string): Promise<void>;
  fetch(dir: string): Promise<void>;
  getBranches(dir: string): Promise<GitBranchesResult>;
  createBranch(dir: string, name: string, from?: string): Promise<void>;
  checkoutBranch(dir: string, name: string): Promise<void>;
  deleteBranch(dir: string, name: string, force?: boolean): Promise<void>;
  renameBranch(dir: string, oldName: string, newName: string): Promise<void>;
  publishBranch(dir: string, name: string): Promise<void>;
  mergeBranch(dir: string, name: string): Promise<void>;
  getLog(dir: string, limit?: number): Promise<GitLogEntry[]>;
  getRemotes(dir: string): Promise<GitRemoteEntry[]>;
  stashPush(dir: string, message?: string): Promise<void>;
  stashPop(dir: string, index?: number): Promise<void>;
  stashDrop(dir: string, index: number): Promise<void>;
  stashList(dir: string): Promise<GitStashEntry[]>;
  getMergeStatus(dir: string): Promise<GitMergeStatus>;
  getStagedDiff(dir: string): Promise<string>;
  getWorkingTreeDiff(dir: string): Promise<string>;
  applyWorkingTreeDiff(dir: string, diffText: string): Promise<boolean>;
  getCommitHeatmap(dir: string, weeks?: number): Promise<Record<string, number>>;
  getDiff(dir: string, relativePath: string): Promise<GitDiffResult>;
  getCommitDetails(dir: string, hash: string): Promise<string>;
  getBlame(dir: string, relativePath: string): Promise<string>;
  searchCommits(dir: string, pattern: string, mode: 'message' | 'content', limit?: number): Promise<GitLogEntry[]>;
  getRepoStats(dir: string): Promise<GitRepoStats>;
  getCommitFiles(dir: string, hash: string): Promise<GitCommitFileEntry[]>;
  getCommitFileDiff(dir: string, hash: string, relativePath: string): Promise<GitDiffResult>;
  getFileHotspots(dir: string, commitLimit?: number, fileLimit?: number): Promise<GitFileHotspot[]>;
  getCommitPatch(dir: string, hash: string): Promise<string>;
  getBranchDiff(dir: string, branchA: string, branchB: string): Promise<GitCommitFileEntry[]>;
  getBranchFileDiff(dir: string, branchA: string, branchB: string, relativePath: string): Promise<GitDiffResult>;
  getCommitGraph(dir: string, limit?: number, skip?: number): Promise<GitGraphCommit[]>;
  discoverRepos(rootDir: string): Promise<GitRepoRoot[]>;
  getFileCommitHistory(dir: string, relativePath: string, limit?: number): Promise<GitLogEntry[]>;
  /** Creates a new branch + an isolated working-directory checkout of it under `dir`'s own `.sde/worktrees/` (matching the `.sde/tasks.json` convention) — the mechanism Parallel Agent Threads uses so two concurrent agent runs never touch each other's uncommitted changes in the same folder. Returns the new worktree's absolute path. */
  createWorktree(dir: string, branchName: string): Promise<string>;
  /** Removes a worktree created by createWorktree — `force` discards any uncommitted changes inside it (the caller already owns that lifecycle; a thread's worktree is scratch space, not meant to be preserved once the thread is discarded). */
  removeWorktree(dir: string, worktreePath: string): Promise<void>;
}

export const IGitService = createServiceIdentifier<IGitService>('gitService');

/** Migrated from a static-methods class to prove the DI container against a real feature; purely structural (instance methods + injected logging), not a rewrite of the git logic. */
export class GitService implements IGitService {
  static readonly inject = [ILogService] as const;
  constructor(private readonly logService: ILogService) {}

  private getGit(dir: string): SimpleGit {
    return simpleGit(dir);
  }

  async isRepo(dir: string): Promise<boolean> {
    if (!dir || !fs.existsSync(dir)) return false;
    try {
      const git = this.getGit(dir);
      return await git.checkIsRepo();
    } catch (err) {
      this.logService.error('Failed to check if directory is Git repository:', err);
      return false;
    }
  }

  async getStatus(dir: string): Promise<GitStatusResult> {
    try {
      const git = this.getGit(dir);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return { isRepo: false, branch: '', files: [], ahead: 0, behind: 0 };
      }

      const status = await git.status();

      const parsedFiles: GitFileEntry[] = status.files.map((f) => {
        const code = f.index + f.working_dir;

        let isStaged = false;
        let isUnstaged = false;
        let statusText = 'Modified';
        let isConflict = false;

        if (f.index !== ' ' && f.index !== '?') isStaged = true;
        if (f.working_dir !== ' ' && f.working_dir !== '?') isUnstaged = true;

        // Conflict detection: both index and working_dir are non-space/non-?
        if (
          f.index === 'U' ||
          f.working_dir === 'U' ||
          (f.index === 'A' && f.working_dir === 'A') ||
          (f.index === 'D' && f.working_dir === 'D')
        ) {
          isConflict = true;
          statusText = 'Conflict';
        } else if (f.index === '?' || f.working_dir === '?') {
          statusText = 'Untracked';
          isUnstaged = true;
        } else if (f.index === 'A') {
          statusText = 'Added';
        } else if (f.index === 'D' || f.working_dir === 'D') {
          statusText = 'Deleted';
        } else if (f.index === 'R' || f.working_dir === 'R') {
          statusText = 'Renamed';
        }

        return {
          path: path.join(dir, f.path),
          relativePath: f.path,
          name: path.basename(f.path),
          isStaged,
          isUnstaged,
          isConflict,
          statusText,
          statusCode: code,
        };
      });

      return {
        isRepo: true,
        branch: status.current || 'detached',
        files: parsedFiles,
        ahead: status.ahead,
        behind: status.behind,
      };
    } catch (err) {
      this.logService.error('Failed to get Git status:', err);
      return { isRepo: false, branch: '', files: [], ahead: 0, behind: 0 };
    }
  }

  async initRepo(dir: string): Promise<boolean> {
    try {
      const git = this.getGit(dir);
      await git.init();
      return true;
    } catch (err) {
      this.logService.error('Failed to initialize Git repository:', err);
      throw err;
    }
  }

  async stageFile(dir: string, relativePath: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.add(relativePath);
    } catch (err) {
      this.logService.error(`Failed to stage file ${relativePath}:`, err);
      throw err;
    }
  }

  async unstageFile(dir: string, relativePath: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.reset([relativePath]);
    } catch (err) {
      this.logService.error(`Failed to unstage file ${relativePath}:`, err);
      throw err;
    }
  }

  async stageAll(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.add('.');
    } catch (err) {
      this.logService.error('Failed to stage all files:', err);
      throw err;
    }
  }

  async unstageAll(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.reset([]);
    } catch (err) {
      this.logService.error('Failed to unstage all files:', err);
      throw err;
    }
  }

  async discardFile(dir: string, relativePath: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      // For untracked files, we need to remove them
      const status = await git.status();
      const file = status.files.find((f) => f.path === relativePath);
      if (file && (file.index === '?' || file.working_dir === '?')) {
        const fullPath = path.join(dir, relativePath);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } else {
        await git.checkout([relativePath]);
      }
    } catch (err) {
      this.logService.error(`Failed to discard changes for ${relativePath}:`, err);
      throw err;
    }
  }

  async discardAll(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.checkout(['.']);
      // Also clean untracked files
      await git.clean('f', ['-d']);
    } catch (err) {
      this.logService.error('Failed to discard all changes:', err);
      throw err;
    }
  }

  async commit(dir: string, message: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.commit(message);
    } catch (err) {
      this.logService.error('Failed to commit changes:', err);
      throw err;
    }
  }

  async undoLastCommit(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.reset(['--soft', 'HEAD~1']);
    } catch (err) {
      this.logService.error('Failed to undo last commit:', err);
      throw err;
    }
  }

  async amendLastCommit(dir: string, message: string): Promise<void> {
    // `--no-edit` was previously passed alongside -m, which git rejects ("cannot be combined"), so this always failed and fell through to a raw-command fallback.
    try {
      const git = this.getGit(dir);
      await git.commit(message, undefined, { '--amend': null });
    } catch (err) {
      this.logService.error('Failed to amend last commit:', err);
      throw err;
    }
  }

  async push(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.push();
    } catch (err) {
      this.logService.error('Failed to push changes:', err);
      throw err;
    }
  }

  async pull(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.pull();
    } catch (err) {
      this.logService.error('Failed to pull changes:', err);
      throw err;
    }
  }

  async fetch(dir: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.fetch(['--all', '--prune']);
    } catch (err) {
      this.logService.error('Failed to fetch:', err);
      throw err;
    }
  }

  async getBranches(dir: string): Promise<GitBranchesResult> {
    try {
      const git = this.getGit(dir);
      const branches = await git.branch(['-a']);
      const local = branches.all.filter((b) => !b.startsWith('remotes/')).map((b) => b.trim());
      const remote = branches.all
        .filter((b) => b.startsWith('remotes/'))
        .map((b) => b.replace('remotes/', '').trim());
      return {
        current: branches.current,
        local,
        remote,
      };
    } catch (err) {
      this.logService.error('Failed to get branches:', err);
      return { current: '', local: [], remote: [] };
    }
  }

  async createBranch(dir: string, name: string, from?: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      if (from) {
        await git.checkoutBranch(name, from);
      } else {
        await git.checkoutLocalBranch(name);
      }
    } catch (err) {
      this.logService.error(`Failed to create branch ${name}:`, err);
      throw err;
    }
  }

  /** Worktrees live under the OS temp dir, never inside `dir` itself — keeps a thread's scratch checkout out of `git status`/the file tree entirely, and out of anything that could accidentally get committed. `branchName` reaches git.raw() as its own argv token (no shell), so it needs no injection-safety sanitizing — `safeName` below is purely for the directory name, since a raw branch name can contain "/" or other characters invalid in a path segment. */
  async createWorktree(dir: string, branchName: string): Promise<string> {
    const git = this.getGit(dir);
    const safeName = branchName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const worktreePath = path.join(os.tmpdir(), 'sde-code-threads', `${safeName}-${Date.now()}`);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    try {
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);
      return worktreePath;
    } catch (err) {
      this.logService.error(`Failed to create worktree for branch "${branchName}":`, err);
      throw err;
    }
  }

  async removeWorktree(dir: string, worktreePath: string): Promise<void> {
    const git = this.getGit(dir);
    try {
      await git.raw(['worktree', 'remove', '--force', worktreePath]);
    } catch (err) {
      this.logService.error(`Failed to remove worktree "${worktreePath}":`, err);
      throw err;
    }
  }

  async checkoutBranch(dir: string, name: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.checkout(name);
    } catch (err) {
      this.logService.error(`Failed to checkout branch ${name}:`, err);
      throw err;
    }
  }

  async deleteBranch(dir: string, name: string, force = false): Promise<void> {
    try {
      const git = this.getGit(dir);
      if (force) {
        await git.branch(['-D', name]);
      } else {
        await git.branch(['-d', name]);
      }
    } catch (err) {
      this.logService.error(`Failed to delete branch ${name}:`, err);
      throw err;
    }
  }

  async renameBranch(dir: string, oldName: string, newName: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.branch(['-m', oldName, newName]);
    } catch (err) {
      this.logService.error(`Failed to rename branch ${oldName} to ${newName}:`, err);
      throw err;
    }
  }

  async publishBranch(dir: string, name: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.push(['--set-upstream', 'origin', name]);
    } catch (err) {
      this.logService.error(`Failed to publish branch ${name}:`, err);
      throw err;
    }
  }

  /** Merges `name` into the current branch; on conflict, rethrows git's own error rather than attempting resolution — GitPanel's conflicted-file detection picks that state up. */
  async mergeBranch(dir: string, name: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.merge([name]);
    } catch (err) {
      this.logService.error(`Failed to merge branch ${name}:`, err);
      throw err;
    }
  }

  private static readonly LOG_FORMAT = {
    hash: '%H',
    shortHash: '%h',
    message: '%s',
    author: '%an',
    date: '%aI',
    refs: '%D',
  };

  private mapLogEntries(log: { all: readonly unknown[] }): GitLogEntry[] {
    return (log.all as Array<{ hash: string; message: string; author: string; date: string; refs?: string }>).map((c) => ({
      hash: c.hash,
      shortHash: c.hash.slice(0, 7),
      message: c.message,
      author: c.author,
      date: c.date,
      refs: c.refs || '',
    }));
  }

  async getLog(dir: string, limit = 20): Promise<GitLogEntry[]> {
    try {
      const git = this.getGit(dir);
      const log = await git.log({
        maxCount: limit,
        format: GitService.LOG_FORMAT,
      });
      return this.mapLogEntries(log);
    } catch (err) {
      this.logService.error('Failed to get commit log:', err);
      return [];
    }
  }

  // `--follow` is needed for `git log -- <path>` to survive renames (a plain path scope stops at the rename commit); passed as a raw flag key since LogOptions has no typed `follow` property.
  async getFileCommitHistory(dir: string, relativePath: string, limit = 50): Promise<GitLogEntry[]> {
    try {
      const git = this.getGit(dir);
      const log = await git.log({
        maxCount: limit,
        format: GitService.LOG_FORMAT,
        file: relativePath,
        '--follow': null,
      } as Record<string, unknown>);
      return this.mapLogEntries(log);
    } catch (err) {
      this.logService.error('Failed to get file commit history:', err);
      return [];
    }
  }

  async getRemotes(dir: string): Promise<GitRemoteEntry[]> {
    try {
      const git = this.getGit(dir);
      const remotes = await git.getRemotes(true);
      return remotes;
    } catch (err) {
      this.logService.error('Failed to get remotes:', err);
      return [];
    }
  }

  async stashPush(dir: string, message?: string): Promise<void> {
    try {
      const git = this.getGit(dir);
      const args = ['push', '--include-untracked'];
      if (message) args.push('-m', message);
      await git.stash(args);
    } catch (err) {
      this.logService.error('Failed to stash changes:', err);
      throw err;
    }
  }

  async stashPop(dir: string, index?: number): Promise<void> {
    try {
      const git = this.getGit(dir);
      if (index !== undefined) {
        await git.stash(['pop', `stash@{${index}}`]);
      } else {
        await git.stash(['pop']);
      }
    } catch (err) {
      this.logService.error('Failed to pop stash:', err);
      throw err;
    }
  }

  async stashDrop(dir: string, index: number): Promise<void> {
    try {
      const git = this.getGit(dir);
      await git.stash(['drop', `stash@{${index}}`]);
    } catch (err) {
      this.logService.error(`Failed to drop stash@{${index}}:`, err);
      throw err;
    }
  }

  async stashList(dir: string): Promise<GitStashEntry[]> {
    try {
      const git = this.getGit(dir);
      const result = await git.stashList();
      return result.all.map((s, i) => ({
        index: i,
        message: s.message,
        date: s.date,
      }));
    } catch (err) {
      this.logService.error('Failed to list stashes:', err);
      return [];
    }
  }

  async getMergeStatus(dir: string): Promise<GitMergeStatus> {
    try {
      const gitDir = path.join(dir, '.git');
      const isMerging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
      const isRebasing = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
      const isCherryPicking = fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'));
      return { isMerging, isRebasing, isCherryPicking };
    } catch {
      return { isMerging: false, isRebasing: false, isCherryPicking: false };
    }
  }

  async getStagedDiff(dir: string): Promise<string> {
    try {
      const git = this.getGit(dir);
      const diff = await git.diff(['--cached', '--stat', '--patch']);
      return diff || '';
    } catch (err) {
      this.logService.error('Failed to get staged diff:', err);
      return '';
    }
  }

  async getWorkingTreeDiff(dir: string): Promise<string> {
    try {
      const git = this.getGit(dir);
      // Diffing against HEAD captures staged AND unstaged changes in one patch; untracked files are never included, a documented scope limit, not a bug.
      const diff = await git.diff(['HEAD', '--patch']);
      return diff || '';
    } catch (err) {
      // A brand-new repo with no commits yet has no HEAD to diff against — an expected "nothing to sync" case, not a real failure.
      this.logService.warn('Failed to get working tree diff (likely an unborn HEAD):', err);
      return '';
    }
  }

  async applyWorkingTreeDiff(dir: string, diffText: string): Promise<boolean> {
    if (!diffText.trim()) return false;
    const tmpFile = path.join(os.tmpdir(), `sde-code-pending-changes-${crypto.randomUUID()}.patch`);
    try {
      fs.writeFileSync(tmpFile, diffText, 'utf8');
      const git = this.getGit(dir);
      await git.raw(['apply', '--whitespace=nowarn', tmpFile]);
      return true;
    } catch (err) {
      // Doesn't apply cleanly (e.g. local tree diverged since capture) — an expected "couldn't apply" outcome the caller surfaces itself, not logged as an error.
      this.logService.warn('Pending-changes diff did not apply cleanly:', err);
      return false;
    } finally {
      fs.rm(tmpFile, { force: true }, () => {});
    }
  }

  async getCommitHeatmap(dir: string, weeks = 52): Promise<Record<string, number>> {
    try {
      const git = this.getGit(dir);
      const since = new Date();
      since.setDate(since.getDate() - weeks * 7);
      const log = await git.log({
        '--after': since.toISOString().split('T')[0],
        format: { date: '%ad' },
        '--date': 'short',
      } as Record<string, unknown>);
      const heatmap: Record<string, number> = {};
      for (const entry of log.all) {
        const d = entry.date;
        heatmap[d] = (heatmap[d] || 0) + 1;
      }
      return heatmap;
    } catch (err) {
      this.logService.error('Failed to get commit heatmap:', err);
      return {};
    }
  }

  async getDiff(dir: string, relativePath: string): Promise<GitDiffResult> {
    try {
      const git = this.getGit(dir);
      const fullPath = path.join(dir, relativePath);

      let modified = '';
      if (fs.existsSync(fullPath)) {
        modified = fs.readFileSync(fullPath, 'utf8');
      }

      let original = '';
      try {
        original = await git.show([`HEAD:${relativePath.replace(/\\/g, '/')}`]);
      } catch {
        this.logService.debug(`File ${relativePath} not found in HEAD, treating as new file.`);
      }

      return { original, modified };
    } catch (err) {
      this.logService.error(`Failed to get diff for ${relativePath}:`, err);
      throw err;
    }
  }

  async getCommitDetails(dir: string, hash: string): Promise<string> {
    try {
      const git = this.getGit(dir);
      const output = await git.raw(['show', hash, '--stat', '--pretty=fuller']);
      return output || '';
    } catch (err) {
      this.logService.error(`Failed to show commit ${hash}:`, err);
      return '';
    }
  }

  async getBlame(dir: string, relativePath: string): Promise<string> {
    try {
      const git = this.getGit(dir);
      const output = await git.raw(['blame', '-w', '--date=short', relativePath.replace(/\\/g, '/')]);
      return output || '';
    } catch (err) {
      this.logService.error(`Failed to blame ${relativePath}:`, err);
      return '';
    }
  }

  // Field/record separators for the raw --pretty=format below (ASCII unit/record separator) can't appear in normal commit text, so splitting on them is unambiguous.
  private static readonly RAW_LOG_FIELD_SEP = '\x1f';
  private static readonly RAW_LOG_RECORD_SEP = '\x1e';

  private parseRawLog(output: string): GitLogEntry[] {
    if (!output) return [];
    return output
      .split(GitService.RAW_LOG_RECORD_SEP)
      .map((record) => record.replace(/^\n/, '').trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, message, author, date, refs] = record.split(GitService.RAW_LOG_FIELD_SEP);
        return { hash, shortHash, message, author, date, refs: refs || '' };
      });
  }

  // Same field/record-separator approach as parseRawLog, extended with a trailing %P (parent hashes); kept as a separate parser so searchCommits' GitLogEntry[] shape stays untouched.
  private parseGraphLog(output: string): GitGraphCommit[] {
    if (!output) return [];
    return output
      .split(GitService.RAW_LOG_RECORD_SEP)
      .map((record) => record.replace(/^\n/, '').trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, message, author, date, refs, parents] = record.split(GitService.RAW_LOG_FIELD_SEP);
        return {
          hash,
          shortHash,
          message,
          author,
          date,
          refs: refs || '',
          parents: parents ? parents.trim().split(' ').filter(Boolean) : [],
        };
      });
  }

  async searchCommits(dir: string, pattern: string, mode: 'message' | 'content', limit = 20): Promise<GitLogEntry[]> {
    try {
      const git = this.getGit(dir);
      // git.log()'s typed options have no -S/--grep equivalent, so this uses git.raw() with a hand-built --pretty=format instead; each flag is a separate argv token, so the pattern never needs escaping.
      const format = `%H${GitService.RAW_LOG_FIELD_SEP}%h${GitService.RAW_LOG_FIELD_SEP}%s${GitService.RAW_LOG_FIELD_SEP}%an${GitService.RAW_LOG_FIELD_SEP}%aI${GitService.RAW_LOG_FIELD_SEP}%D${GitService.RAW_LOG_RECORD_SEP}`;
      const args =
        mode === 'content'
          ? ['log', '--all', `--max-count=${limit}`, `--pretty=format:${format}`, '-S', pattern]
          : ['log', '--all', '-i', `--max-count=${limit}`, `--pretty=format:${format}`, '--grep', pattern];
      const output = await git.raw(args);
      return this.parseRawLog(output);
    } catch (err) {
      this.logService.error(`Failed to search commits for "${pattern}":`, err);
      return [];
    }
  }

  async getRepoStats(dir: string): Promise<GitRepoStats> {
    const empty: GitRepoStats = {
      commitCount: 0,
      branchCount: 0,
      contributorCount: 0,
      tagCount: 0,
      latestTag: null,
      latestCommit: null,
    };

    if (!(await this.isRepo(dir))) return empty;

    const git = this.getGit(dir);

    let commitCount = 0;
    try {
      commitCount = parseInt((await git.raw(['rev-list', '--count', 'HEAD'])).trim(), 10) || 0;
    } catch (err) {
      this.logService.error('Failed to count commits (likely an empty repo):', err);
    }

    const [branches, latestCommitEntries, tags, contributorCount] = await Promise.all([
      this.getBranches(dir),
      this.getLog(dir, 1),
      git.tags().catch((err) => {
        this.logService.error('Failed to list tags:', err);
        return { all: [] as string[], latest: undefined as string | undefined };
      }),
      // git shortlog with zero commits falls back to reading from stdin and simple-git never closes that pipe, hanging forever — must be structurally skipped, not just try/caught.
      commitCount > 0
        ? git
            .raw(['shortlog', '-sn', '--all'])
            .then((out) => out.split('\n').filter((line) => line.trim().length > 0).length)
            .catch((err) => {
              this.logService.error('Failed to count contributors:', err);
              return 0;
            })
        : Promise.resolve(0),
    ]);

    return {
      commitCount,
      branchCount: branches.local.length,
      contributorCount,
      tagCount: tags.all.length,
      latestTag: tags.latest ?? null,
      latestCommit: latestCommitEntries[0] ?? null,
    };
  }

  private static readonly NAME_STATUS_MAP: Record<string, GitCommitFileEntry['statusText']> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
  };

  // `--numstat`'s human-readable form abbreviates renames ambiguously; `-z` sidesteps this — a rename record has an empty 3rd tab-field followed by oldpath/newpath tokens. Verified against a real rename (commit fe09c29).
  private parseNumstatZ(output: string): Map<string, { insertions: number; deletions: number }> {
    const tokens = output.split('\0').filter(Boolean);
    const result = new Map<string, { insertions: number; deletions: number }>();
    let i = 0;
    while (i < tokens.length) {
      const [insRaw, delRaw, path] = tokens[i].split('\t');
      const insertions = insRaw === '-' ? 0 : parseInt(insRaw, 10) || 0;
      const deletions = delRaw === '-' ? 0 : parseInt(delRaw, 10) || 0;
      if (path === '') {
        const newPath = tokens[i + 2];
        result.set(newPath, { insertions, deletions });
        i += 3;
      } else {
        result.set(path, { insertions, deletions });
        i += 1;
      }
    }
    return result;
  }

  // Same `-z` NUL-delimited approach as parseNumstatZ, for --name-status: a rename/copy record (R###/C###) is followed by two path tokens (old, new) instead of one.
  private parseNameStatusZ(output: string): Array<{ path: string; statusText: GitCommitFileEntry['statusText']; fromPath?: string }> {
    const tokens = output.split('\0').filter(Boolean);
    const result: Array<{ path: string; statusText: GitCommitFileEntry['statusText']; fromPath?: string }> = [];
    let i = 0;
    while (i < tokens.length) {
      const code = tokens[i];
      if (code.startsWith('R')) {
        const fromPath = tokens[i + 1];
        const path = tokens[i + 2];
        result.push({ path, statusText: 'Renamed', fromPath });
        i += 3;
      } else {
        const path = tokens[i + 1];
        result.push({ path, statusText: GitService.NAME_STATUS_MAP[code[0]] ?? 'Modified' });
        i += 2;
      }
    }
    return result;
  }

  async getCommitFiles(dir: string, hash: string): Promise<GitCommitFileEntry[]> {
    try {
      const git = this.getGit(dir);
      // -M passed explicitly on both calls for determinism — a user's diff.renames=false (or an older git) could otherwise make them disagree on renames.
      const [numstatOut, nameStatusOut] = await Promise.all([
        git.raw(['show', hash, '-M', '-z', '--numstat', '--pretty=format:']),
        git.raw(['show', hash, '-M', '-z', '--name-status', '--pretty=format:']),
      ]);

      const stats = this.parseNumstatZ(numstatOut);
      const statuses = this.parseNameStatusZ(nameStatusOut);

      return statuses.map((s) => {
        const stat = stats.get(s.path) ?? { insertions: 0, deletions: 0 };
        return {
          path: s.path,
          insertions: stat.insertions,
          deletions: stat.deletions,
          statusText: s.statusText,
          fromPath: s.fromPath,
        };
      });
    } catch (err) {
      this.logService.error(`Failed to get files for commit ${hash}:`, err);
      return [];
    }
  }

  async getCommitFileDiff(dir: string, hash: string, relativePath: string): Promise<GitDiffResult> {
    const git = this.getGit(dir);
    const relPath = relativePath.replace(/\\/g, '/');

    let original = '';
    try {
      original = await git.show([`${hash}^:${relPath}`]);
    } catch {
      this.logService.debug(`File ${relativePath} not found in ${hash}^, treating as newly added.`);
    }

    let modified = '';
    try {
      modified = await git.show([`${hash}:${relPath}`]);
    } catch {
      this.logService.debug(`File ${relativePath} not found in ${hash}, treating as deleted.`);
    }

    return { original, modified };
  }

  async getFileHotspots(dir: string, commitLimit = 1000, fileLimit = 50): Promise<GitFileHotspot[]> {
    try {
      const git = this.getGit(dir);
      // No typed simple-git method aggregates per-file change counts, so git.raw() + hand-parsing; --max-count bounds the walk since unbounded `git log --name-only` crashed on a large repo before (see indexer.ts).
      const output = await git.raw(['log', `--max-count=${commitLimit}`, '--name-only', '--pretty=format:']);
      const counts = new Map<string, number>();
      for (const line of output.split('\n')) {
        const filePath = line.trim();
        if (!filePath) continue;
        counts.set(filePath, (counts.get(filePath) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([filePath, changeCount]) => ({ path: filePath, changeCount }))
        .sort((a, b) => b.changeCount - a.changeCount)
        .slice(0, fileLimit);
    } catch (err) {
      this.logService.error('Failed to get file hotspots:', err);
      return [];
    }
  }

  async getCommitPatch(dir: string, hash: string): Promise<string> {
    try {
      const git = this.getGit(dir);
      const output = await git.raw(['show', hash, '--stat', '--patch']);
      return output || '';
    } catch (err) {
      this.logService.error(`Failed to get commit patch for ${hash}:`, err);
      return '';
    }
  }

  async getBranchDiff(dir: string, branchA: string, branchB: string): Promise<GitCommitFileEntry[]> {
    try {
      const git = this.getGit(dir);
      const range = `${branchA}...${branchB}`;
      // Same -M/-z --numstat + --name-status approach as getCommitFiles; `git diff` never prints a commit-message header, so no --pretty=format: suppression is needed.
      const [numstatOut, nameStatusOut] = await Promise.all([
        git.raw(['diff', range, '-M', '-z', '--numstat']),
        git.raw(['diff', range, '-M', '-z', '--name-status']),
      ]);

      const stats = this.parseNumstatZ(numstatOut);
      const statuses = this.parseNameStatusZ(nameStatusOut);

      return statuses.map((s) => {
        const stat = stats.get(s.path) ?? { insertions: 0, deletions: 0 };
        return {
          path: s.path,
          insertions: stat.insertions,
          deletions: stat.deletions,
          statusText: s.statusText,
          fromPath: s.fromPath,
        };
      });
    } catch (err) {
      this.logService.error(`Failed to get diff between ${branchA} and ${branchB}:`, err);
      return [];
    }
  }

  async getBranchFileDiff(dir: string, branchA: string, branchB: string, relativePath: string): Promise<GitDiffResult> {
    const git = this.getGit(dir);
    const relPath = relativePath.replace(/\\/g, '/');

    let original = '';
    try {
      original = await git.show([`${branchA}:${relPath}`]);
    } catch {
      this.logService.debug(`File ${relativePath} not found in ${branchA}, treating as newly added.`);
    }

    let modified = '';
    try {
      modified = await git.show([`${branchB}:${relPath}`]);
    } catch {
      this.logService.debug(`File ${relativePath} not found in ${branchB}, treating as deleted.`);
    }

    return { original, modified };
  }

  async getCommitGraph(dir: string, limit = 300, skip = 0): Promise<GitGraphCommit[]> {
    try {
      const git = this.getGit(dir);
      // --skip isn't in simple-git's typed LogOptions, so this goes through git.raw(); --all so the graph shows real cross-branch topology, not just the current branch's linear history.
      const format = `%H${GitService.RAW_LOG_FIELD_SEP}%h${GitService.RAW_LOG_FIELD_SEP}%s${GitService.RAW_LOG_FIELD_SEP}%an${GitService.RAW_LOG_FIELD_SEP}%aI${GitService.RAW_LOG_FIELD_SEP}%D${GitService.RAW_LOG_FIELD_SEP}%P${GitService.RAW_LOG_RECORD_SEP}`;
      const output = await git.raw([
        'log',
        '--all',
        `--max-count=${limit}`,
        `--skip=${skip}`,
        `--pretty=format:${format}`,
      ]);
      return this.parseGraphLog(output);
    } catch (err) {
      this.logService.error('Failed to get commit graph:', err);
      return [];
    }
  }

  // Same directory names indexer.ts's crawlDirectory already ignores, skipped here for the same reason (noise, and node_modules can vendor its own .git dirs).
  private static readonly REPO_SCAN_IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'build', 'out', 'bin', 'obj', '.svelte-kit', '.next']);
  // Bounded like indexer.ts's MAX_INDEXABLE_FILES — an unbounded recursive scan caused a real crash earlier (see indexer.ts's history).
  private static readonly MAX_SCANNED_DIRS = 2000;
  private static readonly MAX_SCAN_DEPTH = 3;

  async discoverRepos(rootDir: string): Promise<GitRepoRoot[]> {
    const repos: GitRepoRoot[] = [];
    let scanned = 0;

    const visit = async (dir: string, depth: number): Promise<void> => {
      if (scanned >= GitService.MAX_SCANNED_DIRS) return;
      scanned++;

      if (await this.isRepo(dir)) {
        repos.push({ path: dir, name: path.basename(dir) });
        // Don't descend into a repo's own working tree for nested repos — its history already covers everything under it, and this bounds scan cost.
        return;
      }

      if (depth >= GitService.MAX_SCAN_DEPTH) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (scanned >= GitService.MAX_SCANNED_DIRS) return;
        if (!entry.isDirectory() || GitService.REPO_SCAN_IGNORE_DIRS.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), depth + 1);
      }
    };

    try {
      await visit(rootDir, 0);
    } catch (err) {
      this.logService.error('Failed to discover nested repos:', err);
    }

    return repos;
  }
}
