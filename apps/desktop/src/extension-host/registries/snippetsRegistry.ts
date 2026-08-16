import path from 'path';
import type { SnippetsContribution, ResolvedSnippetContribution } from '@sde-code/protocol';
import { createServiceIdentifier, IDatabaseService, ILogService } from '../../platform';
import { IExtensionHostService } from '../runtime';

export interface ISnippetsRegistry {
  list(): ResolvedSnippetContribution[];
  listForLanguage(languageId: string): ResolvedSnippetContribution[];
}

export const ISnippetsRegistry = createServiceIdentifier<ISnippetsRegistry>('snippetsRegistry');

/** Template for declarative-contribution registries: reads via getStaticContributions(), filters disabled extensions, validates each entry, log+skip rather than throw. */
export class SnippetsRegistry implements ISnippetsRegistry {
  static readonly inject = [IExtensionHostService, IDatabaseService, ILogService] as const;
  constructor(
    private readonly extensionHostService: IExtensionHostService,
    private readonly databaseService: IDatabaseService,
    private readonly logService: ILogService,
  ) {}

  list(): ResolvedSnippetContribution[] {
    const disabledIds = new Set(
      this.databaseService.getExtensions().filter((e) => e.is_enabled === 0).map((e) => e.id),
    );

    const result: ResolvedSnippetContribution[] = [];
    for (const { extensionId, rootDir, value } of
      this.extensionHostService.getStaticContributions<SnippetsContribution[]>('snippets')) {
      if (disabledIds.has(extensionId)) continue;
      for (const entry of value) {
        const resolved = this.validate(extensionId, rootDir, entry);
        if (resolved) result.push(resolved);
      }
    }
    return result;
  }

  listForLanguage(languageId: string): ResolvedSnippetContribution[] {
    return this.list().filter((c) => c.language === languageId);
  }

  /** Same threat model as platform/ai/agentTools.ts's isWithinWorkspace: a manifest could declare path: "../../../etc/passwd". */
  private validate(extensionId: string, rootDir: string, entry: SnippetsContribution): ResolvedSnippetContribution | null {
    if (!entry?.language?.trim() || !entry?.path?.trim()) {
      this.logService.error(`Extension "${extensionId}" declared an invalid snippets contribution (missing language or path) — skipping.`);
      return null;
    }

    const normRoot = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
    const resolved = path.resolve(rootDir, entry.path);
    const normResolved = resolved.replace(/\\/g, '/');
    if (normResolved !== normRoot && !normResolved.startsWith(`${normRoot}/`)) {
      this.logService.error(`Extension "${extensionId}" declared a snippets path outside its own directory ("${entry.path}") — skipping.`);
      return null;
    }

    return { extensionId, language: entry.language, absolutePath: resolved };
  }
}
