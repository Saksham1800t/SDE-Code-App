import path from 'path';
import type { AITool } from '@sde-code/sdk';
import type { GitLogEntry } from '@sde-code/protocol';
import type { IGitService } from '../git';
import { resolveWorkspacePath, isWithinWorkspace } from './agentTools';

export interface RepoToolDeps {
  workspacePath: string;
  gitService: IGitService;
}

const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 50;
const COMMIT_DETAILS_LIMIT = 8000;
const BLAME_LIMIT = 12000;

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : DEFAULT_LOG_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOG_LIMIT;
  return Math.min(n, MAX_LOG_LIMIT);
}

function formatLogEntries(entries: GitLogEntry[]): string {
  return entries.map((e) => `${e.shortHash}  ${e.date}  ${e.author}: ${e.message}`).join('\n');
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n... (truncated)` : text;
}

/** Read-only git-history tools for "Ask Repository" mode — a much smaller set than createAgentTools' file-editing tools since these are pure queries with no side effects and never call requestApproval. */
export function createRepoTools(deps: RepoToolDeps): AITool[] {
  return [
    {
      name: 'git_log',
      description: 'List recent commits in this repository, most recent first. Returns hash, author, date, and commit message for each.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of commits to return. Defaults to 20, capped at 50.' },
        },
        required: [],
      },
      async execute(args) {
        const limit = clampLimit(args.limit);
        const entries = await deps.gitService.getLog(deps.workspacePath, limit);
        return entries.length > 0 ? formatLogEntries(entries) : 'No commits found.';
      },
    },

    {
      name: 'git_show',
      description:
        "Show one commit's full metadata (author, date, message) and the list of files it changed with insertion/deletion counts. Does not include the full line-by-line diff.",
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'The commit hash (full or abbreviated) to inspect.' },
        },
        required: ['hash'],
      },
      async execute(args) {
        const hash = String(args.hash ?? '').trim();
        if (!hash) return 'Error: hash is required.';
        const details = await deps.gitService.getCommitDetails(deps.workspacePath, hash);
        return details ? truncate(details, COMMIT_DETAILS_LIMIT) : `Error: no commit found for "${hash}".`;
      },
    },

    {
      name: 'git_blame',
      description:
        'Show, for each line of a tracked file, which commit last changed it, who authored that commit, and when. Useful for finding who wrote or last touched a specific piece of code.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file, relative to the workspace root.' },
        },
        required: ['filePath'],
      },
      async execute(args) {
        const filePath = String(args.filePath ?? '');
        const resolved = resolveWorkspacePath([deps.workspacePath], filePath);
        if (!isWithinWorkspace([deps.workspacePath], resolved)) {
          return `Error: "${filePath}" resolves outside the workspace root.`;
        }
        const relative = path.relative(deps.workspacePath, resolved).replace(/\\/g, '/');
        const blame = await deps.gitService.getBlame(deps.workspacePath, relative);
        return blame ? truncate(blame, BLAME_LIMIT) : `Error: could not blame "${filePath}" — check the path is correct and the file is tracked in git.`;
      },
    },

    {
      name: 'git_search',
      description:
        "Search commit history either by commit message text or by a string that was added/removed in the code (pickaxe search). Returns matching commits' hash, author, date, and message.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for.' },
          mode: {
            type: 'string',
            enum: ['message', 'content'],
            description:
              '"message" searches commit messages (case-insensitive substring). "content" finds commits that added or removed this exact string in the code. Defaults to "message".',
          },
          limit: { type: 'number', description: 'Maximum number of commits to return. Defaults to 20, capped at 50.' },
        },
        required: ['query'],
      },
      async execute(args) {
        const query = String(args.query ?? '').trim();
        if (!query) return 'Error: query is required.';
        const mode = args.mode === 'content' ? 'content' : 'message';
        const limit = clampLimit(args.limit);
        const entries = await deps.gitService.searchCommits(deps.workspacePath, query, mode, limit);
        return entries.length > 0 ? formatLogEntries(entries) : 'No commits found.';
      },
    },
  ];
}
