import fs from 'fs';
import path from 'path';
import { parse as parseJsonc, ParseError } from 'jsonc-parser';
import type { SnippetDefinition, ResolvedSnippetContribution } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { IFileSystemService } from '../fs';
import { SNIPPET_TEMPLATES, genericSnippetTemplate } from './snippetTemplates';

interface RawSnippetBody {
  prefix: string | string[];
  body: string | string[];
  description?: string;
}

export interface ISnippetsService {
  /** Must be called once, before the methods below, with the real per-user snippets directory (see host/index.ts). */
  initialize(snippetsDirPath: string): Promise<void>;
  /** `extensionContributions` is the already-resolved, enable/disable-filtered list produced by extension-host's SnippetsRegistry and passed in as plain data, since this layer must never import extension-host/ directly. */
  getSnippetsForLanguage(languageId: string, extensionContributions: ResolvedSnippetContribution[]): Promise<SnippetDefinition[]>;
  /** Creates `<language>.json` with starter content if missing; returns the real path either way. */
  ensureUserSnippetFile(languageId: string): Promise<string>;
  /** Language ids with an existing personal snippet file, derived from filenames under the snippets dir. */
  listUserSnippetFiles(): Promise<string[]>;
  /** Raw file content, verbatim — for cloud sync push. Throws if the file doesn't exist. */
  getUserSnippetFileContent(languageId: string): Promise<string>;
  /** Overwrites (creating if needed) `<language>.json` with raw content — for cloud sync pull/restore. */
  writeUserSnippetFileContent(languageId: string, content: string): Promise<void>;
}

export const ISnippetsService = createServiceIdentifier<ISnippetsService>('snippetsService');

/** No lazy/memoized per-file caching, unlike VS Code's SnippetFile.load() — this app has no hot extension reload, so reading + parsing on every call is an acceptable v1 simplification. */
export class SnippetsService implements ISnippetsService {
  static readonly inject = [IFileSystemService, ILogService] as const;
  private snippetsDirPath: string | null = null;

  constructor(
    private readonly fileSystemService: IFileSystemService,
    private readonly logService: ILogService,
  ) {}

  async initialize(snippetsDirPath: string): Promise<void> {
    this.snippetsDirPath = snippetsDirPath;
  }

  async getSnippetsForLanguage(languageId: string, extensionContributions: ResolvedSnippetContribution[]): Promise<SnippetDefinition[]> {
    const result: SnippetDefinition[] = [];

    const userPath = this.userSnippetFilePath(languageId);
    if (fs.existsSync(userPath)) {
      result.push(...(await this.loadFile(userPath, 'user')));
    }

    for (const contribution of extensionContributions.filter((c) => c.language === languageId)) {
      result.push(...(await this.loadFile(contribution.absolutePath, 'extension', contribution.extensionId)));
    }

    return result;
  }

  async ensureUserSnippetFile(languageId: string): Promise<string> {
    const filePath = this.userSnippetFilePath(languageId);
    if (!fs.existsSync(filePath)) {
      const starter = SNIPPET_TEMPLATES[languageId] ?? genericSnippetTemplate(languageId);
      await this.fileSystemService.writeFile(filePath, starter);
    }
    return filePath;
  }

  async listUserSnippetFiles(): Promise<string[]> {
    if (!this.snippetsDirPath) {
      throw new Error('SnippetsService.initialize() must be called before use.');
    }
    if (!fs.existsSync(this.snippetsDirPath)) {
      return [];
    }
    return fs
      .readdirSync(this.snippetsDirPath)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  }

  async getUserSnippetFileContent(languageId: string): Promise<string> {
    return this.fileSystemService.readFile(this.userSnippetFilePath(languageId));
  }

  async writeUserSnippetFileContent(languageId: string, content: string): Promise<void> {
    await this.fileSystemService.writeFile(this.userSnippetFilePath(languageId), content);
  }

  private userSnippetFilePath(languageId: string): string {
    if (!this.snippetsDirPath) {
      throw new Error('SnippetsService.initialize() must be called before use.');
    }
    return path.join(this.snippetsDirPath, `${languageId}.json`);
  }

  private async loadFile(filePath: string, source: 'user' | 'extension', extensionId?: string): Promise<SnippetDefinition[]> {
    try {
      const content = await this.fileSystemService.readFile(filePath);
      const errors: ParseError[] = [];
      const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
      if (errors.length > 0) {
        this.logService.error(`Snippet file "${filePath}" has JSON syntax errors near offset ${errors[0].offset}; parsed as far as possible.`);
      }
      if (!parsed || typeof parsed !== 'object') {
        return [];
      }

      return Object.entries(parsed as Record<string, RawSnippetBody>).map(([name, def]) => ({
        name,
        prefix: def.prefix,
        body: def.body,
        description: def.description,
        source,
        extensionId,
      }));
    } catch (err) {
      this.logService.error(`Failed to load snippet file "${filePath}":`, err);
      return [];
    }
  }
}
