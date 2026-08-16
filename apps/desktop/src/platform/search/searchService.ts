import fs from 'fs';
import path from 'path';
import type { SearchMatch, SearchFileResult, SearchInFilesOptions, ReplaceInFilesResult, WorkspaceSymbolResult } from '@sde-code/protocol';
import { extractSymbols } from '../../shared/extractSymbols';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';

// Re-exported so consumers don't need to know these types live in @sde-code/protocol now — same pattern platform/git/gitService.ts uses.
export type { SearchMatch, SearchFileResult, SearchInFilesOptions, ReplaceInFilesResult, WorkspaceSymbolResult };

export interface ISearchService {
  searchInFiles(rootDir: string, query: string, options: SearchInFilesOptions): Promise<SearchFileResult[]>;
  listAllFiles(rootDir: string): Promise<string[]>;
  replaceInFiles(
    rootDir: string,
    query: string,
    replaceText: string,
    options: SearchInFilesOptions,
    targetFile?: string,
  ): Promise<ReplaceInFilesResult>;
  searchWorkspaceSymbols(rootDir: string): Promise<WorkspaceSymbolResult[]>;
}

export const ISearchService = createServiceIdentifier<ISearchService>('searchService');

/** Migrated verbatim from host/ipc.ts's anonymous search:* handler closures into an injectable instance, so platform/ai's agent tools can reuse the Search sidebar's exact behavior instead of duplicating it. */
export class SearchService implements ISearchService {
  static readonly inject = [ILogService] as const;
  constructor(private readonly logService: ILogService) {}

  /** Shared regex construction so search and replace always match identically. */
  private buildSearchRegex(query: string, options: SearchInFilesOptions): RegExp | null {
    try {
      const pattern = options.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordBoundary = options.wholeWord ? `\\b${pattern}\\b` : pattern;
      return new RegExp(wordBoundary, options.caseSensitive ? 'g' : 'gi');
    } catch (err) {
      this.logService.debug('Invalid search pattern:', err);
      return null;
    }
  }

  async searchInFiles(rootDir: string, query: string, options: SearchInFilesOptions): Promise<SearchFileResult[]> {
    if (!query || !rootDir) return [];

    const results: SearchFileResult[] = [];

    const defaultExcludes = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt'];
    const userExcludes = options.excludeGlob ? options.excludeGlob.split(',').map((s) => s.trim()) : [];
    const allExcludes = [...defaultExcludes, ...userExcludes];

    const regex = this.buildSearchRegex(query, options);
    if (!regex) return [];

    const walkDir = (dir: string) => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (allExcludes.some((ex) => entry === ex || entry.startsWith('.'))) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (stat.isFile() && stat.size < 1024 * 512) {
          if (options.includeGlob) {
            const globs = options.includeGlob.split(',').map((s) => s.trim());
            const ext = path.extname(entry).slice(1);
            if (!globs.some((g) => g === `*.${ext}` || g === entry || g === '*')) continue;
          }
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const fileMatches: SearchMatch[] = [];
            lines.forEach((lineText, idx) => {
              regex.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = regex.exec(lineText)) !== null) {
                fileMatches.push({
                  line: idx + 1,
                  text: lineText,
                  matchStart: match.index,
                  matchEnd: match.index + match[0].length,
                });
                if (!regex.global) break;
              }
            });
            if (fileMatches.length > 0) {
              results.push({
                file: fullPath,
                relativePath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
                matches: fileMatches.slice(0, 50),
              });
            }
          } catch {
            // skip binary or unreadable files
          }
        }
        if (results.length >= 200) return;
      }
    };

    walkDir(rootDir);
    return results;
  }

  async replaceInFiles(
    rootDir: string,
    query: string,
    replaceText: string,
    options: SearchInFilesOptions,
    targetFile?: string,
  ): Promise<ReplaceInFilesResult> {
    if (!query || !rootDir) return { filesChanged: 0, matchesReplaced: 0 };

    // Reuses the exact same matching pass as a plain search so results and replacements can never diverge; scoped to one file when replacing a single file's matches.
    const matches = targetFile
      ? (await this.searchInFiles(rootDir, query, options)).filter((r) => r.file === targetFile)
      : await this.searchInFiles(rootDir, query, options);

    const regex = this.buildSearchRegex(query, options);
    if (!regex) return { filesChanged: 0, matchesReplaced: 0 };
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);

    let filesChanged = 0;
    let matchesReplaced = 0;
    for (const fileResult of matches) {
      try {
        const content = fs.readFileSync(fileResult.file, 'utf-8');
        let count = 0;
        const updated = content.replace(globalRegex, () => {
          count++;
          return replaceText;
        });
        if (count > 0) {
          fs.writeFileSync(fileResult.file, updated, 'utf-8');
          filesChanged++;
          matchesReplaced += count;
        }
      } catch (err) {
        this.logService.debug(`Failed to replace in ${fileResult.file}:`, err);
      }
    }

    return { filesChanged, matchesReplaced };
  }

  async listAllFiles(rootDir: string): Promise<string[]> {
    if (!rootDir) return [];
    const files: string[] = [];
    const excludes = ['node_modules', '.git', 'dist', 'build', 'out', '.next'];

    const walkDir = (dir: string) => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (excludes.includes(entry) || entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else {
          files.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
        }
        if (files.length >= 5000) return;
      }
    };

    walkDir(rootDir);
    return files.sort();
  }

  async searchWorkspaceSymbols(rootDir: string): Promise<WorkspaceSymbolResult[]> {
    if (!rootDir) return [];
    const results: WorkspaceSymbolResult[] = [];
    const excludes = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt'];
    // Same language coverage as the in-file `@` symbol search (extractSymbols) — no real language service, just a heuristic matching common declaration shapes.
    const extToLanguage: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', py: 'python',
    };

    const walkDir = (dir: string) => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (excludes.includes(entry) || entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (stat.isFile() && stat.size < 1024 * 512) {
          const languageId = extToLanguage[path.extname(entry).slice(1)];
          if (languageId) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
              for (const symbol of extractSymbols(content, languageId)) {
                results.push({ ...symbol, relativePath, file: fullPath });
              }
            } catch {
              // skip binary or unreadable files
            }
          }
        }
        if (results.length >= 5000) return;
      }
    };

    walkDir(rootDir);
    return results;
  }
}
