import path from 'path';
import type { AITool } from '@sde-code/sdk';
import type { AgentFileChange, AgentPolicyToolName, AgentToolPolicy } from '@sde-code/protocol';
import type { IFileSystemService } from '../fs';
import type { ISearchService } from '../search';
import type { RunCommandResult } from './agentTerminalRunner';

export interface AgentToolDeps {
  /** Every open workspace folder — a model-supplied relative path resolves against the first (primary) one; an absolute path is validated against all of them. */
  workspaceFolders: string[];
  fileSystemService: IFileSystemService;
  searchService: ISearchService;
  /** Mutated in place by the staging tools below — the caller owns reading it back out. */
  workingSet: Map<string, AgentFileChange>;
  /** Aborting this cancels a run_terminal_command call in progress, same as every other tool. */
  signal: AbortSignal;
  runCommand: (command: string, cwd: string, signal: AbortSignal) => Promise<RunCommandResult>;
}

/** Resolves a model-supplied path against the workspace root, normalized to forward slashes to match EditorTab.path; a relative path always resolves against the first (primary) folder. */
export function resolveWorkspacePath(workspaceFolders: string[], relativeOrAbsolute: string): string {
  // path.normalize() on the absolute branch is load-bearing: without it, an unresolved ".." could string-match inside the workspace root but resolve outside it at the OS level.
  const resolved = path.isAbsolute(relativeOrAbsolute)
    ? path.normalize(relativeOrAbsolute)
    : path.join(workspaceFolders[0] ?? '', relativeOrAbsolute);
  return resolved.replace(/\\/g, '/');
}

/** Guards against a model (hallucinated or prompt-injected) escaping every open workspace folder via "../../..". */
export function isWithinWorkspace(workspaceFolders: string[], resolvedPath: string): boolean {
  return workspaceFolders.some((folder) => {
    const normFolder = folder.replace(/\\/g, '/').replace(/\/$/, '');
    return resolvedPath === normFolder || resolvedPath.startsWith(`${normFolder}/`);
  });
}

/** Tools that only ever read; Workspace Trust uses this to keep read-only exploration available in Restricted Mode while filtering out anything mutating. */
export const READ_ONLY_AGENT_TOOL_NAMES = new Set(['read_file', 'list_directory', 'search_files']);

/** Built-in agent tools: read/search/propose-edit plus approval-gated terminal execution; file-mutating tools stage into `deps.workingSet` rather than touching disk directly, applied later via workspace.ts's acceptAgentFileChange. */
export function createAgentTools(deps: AgentToolDeps): AITool[] {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file in the workspace. Returns up to 20000 characters; longer files are truncated.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file, relative to the workspace root.' },
        },
        required: ['filePath'],
      },
      async execute(args) {
        const filePath = String(args.filePath ?? '');
        const resolved = resolveWorkspacePath(deps.workspaceFolders,filePath);
        if (!isWithinWorkspace(deps.workspaceFolders,resolved)) {
          return `Error: "${filePath}" resolves outside the workspace root.`;
        }
        try {
          const content = await deps.fileSystemService.readFile(resolved);
          return content.length > 20000 ? `${content.slice(0, 20000)}\n... (truncated)` : content;
        } catch (err: any) {
          return `Error reading file: ${err?.message || err}`;
        }
      },
    },

    {
      name: 'list_directory',
      description: 'List the files and subdirectories inside a directory in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          dirPath: { type: 'string', description: 'Path to the directory, relative to the workspace root. Use "." for the workspace root.' },
        },
        required: ['dirPath'],
      },
      async execute(args) {
        const dirPath = String(args.dirPath ?? '.');
        const resolved = resolveWorkspacePath(deps.workspaceFolders,dirPath);
        if (!isWithinWorkspace(deps.workspaceFolders,resolved)) {
          return `Error: "${dirPath}" resolves outside the workspace root.`;
        }
        try {
          const entries = await deps.fileSystemService.readDir(resolved);
          return JSON.stringify(entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory })));
        } catch (err: any) {
          return `Error listing directory: ${err?.message || err}`;
        }
      },
    },

    {
      name: 'search_files',
      description: 'Search for a text or regex pattern across files in the workspace. Returns matching lines as "path:line — text".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regex pattern to search for.' },
          isRegex: { type: 'boolean', description: 'Treat query as a regular expression. Defaults to false.' },
          includeGlob: { type: 'string', description: 'Comma-separated extensions to restrict the search to, e.g. "*.ts,*.tsx". Optional.' },
        },
        required: ['query'],
      },
      async execute(args) {
        const query = String(args.query ?? '');
        if (!query) {
          return 'Error: query is required.';
        }
        // Fans out across every open folder; relativePath alone is ambiguous with more than one root, so each match gets its folder name prefixed.
        const perFolderResults = await Promise.all(
          deps.workspaceFolders.map((folder) =>
            deps.searchService.searchInFiles(folder, query, {
              caseSensitive: false,
              isRegex: Boolean(args.isRegex),
              wholeWord: false,
              includeGlob: typeof args.includeGlob === 'string' ? args.includeGlob : '',
              excludeGlob: '',
            }),
          ),
        );
        const multiRoot = deps.workspaceFolders.length > 1;
        const lines: string[] = [];
        outer: for (let i = 0; i < perFolderResults.length; i++) {
          const folderLabel = multiRoot ? `${deps.workspaceFolders[i].split(/[\\/]/).pop()}/` : '';
          for (const file of perFolderResults[i]) {
            for (const match of file.matches) {
              lines.push(`${folderLabel}${file.relativePath}:${match.line} — ${match.text.trim()}`);
              if (lines.length >= 40) break outer;
            }
          }
        }
        return lines.length > 0 ? lines.join('\n') : 'No matches found.';
      },
    },

    {
      name: 'propose_file_edit',
      description: 'Propose replacing the full contents of an existing file. The change is staged for user review, not written to disk immediately.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file, relative to the workspace root.' },
          content: { type: 'string', description: 'The full new contents of the file.' },
        },
        required: ['filePath', 'content'],
      },
      async execute(args) {
        const filePath = String(args.filePath ?? '');
        const content = String(args.content ?? '');
        const resolved = resolveWorkspacePath(deps.workspaceFolders,filePath);
        if (!isWithinWorkspace(deps.workspaceFolders,resolved)) {
          return `Error: "${filePath}" resolves outside the workspace root.`;
        }

        const existing = deps.workingSet.get(resolved);
        if (existing) {
          existing.proposedContent = content;
          existing.isDeleted = false;
          return `Staged an update to ${filePath} (pending user review).`;
        }

        let originalContent = '';
        try {
          originalContent = await deps.fileSystemService.readFile(resolved);
        } catch {
          return `Error: "${filePath}" does not exist. Use create_file to create a new file.`;
        }

        deps.workingSet.set(resolved, { filePath: resolved, originalContent, proposedContent: content, isNew: false, isDeleted: false });
        return `Staged an edit to ${filePath} (pending user review).`;
      },
    },

    {
      name: 'create_file',
      description: 'Propose creating a new file with the given contents. Fails if the file already exists — use propose_file_edit instead.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the new file, relative to the workspace root.' },
          content: { type: 'string', description: 'The full contents of the new file.' },
        },
        required: ['filePath', 'content'],
      },
      async execute(args) {
        const filePath = String(args.filePath ?? '');
        const content = String(args.content ?? '');
        const resolved = resolveWorkspacePath(deps.workspaceFolders,filePath);
        if (!isWithinWorkspace(deps.workspaceFolders,resolved)) {
          return `Error: "${filePath}" resolves outside the workspace root.`;
        }

        if (deps.workingSet.has(resolved)) {
          return `Error: "${filePath}" already has a pending change staged. Use propose_file_edit to modify it further.`;
        }
        try {
          await deps.fileSystemService.readFile(resolved);
          return `Error: "${filePath}" already exists. Use propose_file_edit instead.`;
        } catch {
          // Doesn't exist yet — proceed.
        }

        deps.workingSet.set(resolved, { filePath: resolved, originalContent: '', proposedContent: content, isNew: true, isDeleted: false });
        return `Staged creation of ${filePath} (pending user review).`;
      },
    },

    {
      name: 'delete_file',
      description: 'Propose deleting an existing file. The deletion is staged for user review, not applied to disk immediately.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file, relative to the workspace root.' },
        },
        required: ['filePath'],
      },
      async execute(args) {
        const filePath = String(args.filePath ?? '');
        const resolved = resolveWorkspacePath(deps.workspaceFolders,filePath);
        if (!isWithinWorkspace(deps.workspaceFolders,resolved)) {
          return `Error: "${filePath}" resolves outside the workspace root.`;
        }

        const existing = deps.workingSet.get(resolved);
        let originalContent = existing?.originalContent ?? '';
        if (!existing) {
          try {
            originalContent = await deps.fileSystemService.readFile(resolved);
          } catch {
            return `Error: "${filePath}" does not exist.`;
          }
        }

        deps.workingSet.set(resolved, { filePath: resolved, originalContent, proposedContent: '', isNew: false, isDeleted: true });
        return `Staged deletion of ${filePath} (pending user review).`;
      },
    },

    {
      name: 'run_terminal_command',
      description: 'Run a shell command in the workspace root. Depending on the user\'s Agent Profile settings, this may require explicit approval before it executes.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
      async execute(args) {
        const command = String(args.command ?? '').trim();
        if (!command) {
          return 'Error: command is required.';
        }

        // Approval (if this tool's Agent Profile policy is "ask") happens one layer up, in applyAgentToolPolicies — see its doc comment for why the gate isn't hardcoded into this tool anymore.
        // An AbortError here propagates up uncaught, intentionally, into agentQuery()'s existing isAbortError() handling.
        const result = await deps.runCommand(command, deps.workspaceFolders[0] ?? '', deps.signal);

        const parts: string[] = [];
        if (result.stdout) {
          parts.push(`stdout:\n${result.stdout}`);
        }
        if (result.stderr) {
          parts.push(`stderr:\n${result.stderr}`);
        }
        parts.push(`exit code: ${result.exitCode ?? '(unknown — the command may have been killed for running too long)'}`);
        return parts.join('\n\n');
      },
    },
  ];
}

/** Short human-readable description of a tool call, shown in the Approve/Deny prompt when a tool's Agent Profile policy is "ask". */
function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'run_terminal_command':
      return String(args.command ?? '');
    case 'read_file':
    case 'propose_file_edit':
    case 'create_file':
    case 'delete_file':
      return String(args.filePath ?? '');
    case 'list_directory':
      return String(args.dirPath ?? '.');
    case 'search_files':
      return String(args.query ?? '');
    default:
      return JSON.stringify(args).slice(0, 200);
  }
}

/**
 * Applies a per-tool Agent Profile policy on top of an already-built tool list: `deny`
 * removes the tool entirely (the model never sees it as available, same as Workspace
 * Trust's Restricted Mode filtering above), `ask` wraps `execute` to block on the
 * caller-supplied approval gate first, `allow` (or any tool name not present in
 * `policies`, e.g. an extension tool) passes through untouched. Kept as a wrapper over
 * an already-built tool list — not baked into createAgentTools itself — so the same
 * approval mechanism can gate any tool uniformly instead of each tool re-implementing it.
 */
export function applyAgentToolPolicies(
  tools: AITool[],
  policies: Partial<Record<AgentPolicyToolName, AgentToolPolicy>>,
  requestApproval: (toolName: string, argsSummary: string) => Promise<boolean>,
): AITool[] {
  return tools
    .filter((tool) => policies[tool.name as AgentPolicyToolName] !== 'deny')
    .map((tool) => {
      if (policies[tool.name as AgentPolicyToolName] !== 'ask') return tool;
      return {
        ...tool,
        async execute(args: Record<string, unknown>) {
          const approved = await requestApproval(tool.name, summarizeToolArgs(tool.name, args));
          if (!approved) return `The user denied this action (${tool.name}). It was not executed.`;
          return tool.execute(args);
        },
      };
    });
}
