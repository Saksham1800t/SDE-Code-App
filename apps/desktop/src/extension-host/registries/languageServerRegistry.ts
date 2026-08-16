import type { LanguageServerContribution, ResolvedLanguageServerContribution } from '@sde-code/protocol';
import { createServiceIdentifier, IDatabaseService, ILogService, type IExtensionLanguageServerProvider } from '../../platform';
import { IExtensionHostService } from '../runtime';

export const ILanguageServerRegistry = createServiceIdentifier<IExtensionLanguageServerProvider & { list(): ResolvedLanguageServerContribution[] }>('languageServerRegistry');

/**
 * Extension-contributed LSP servers, declared statically via
 * `contributes.languageServers` — same shape as SnippetsRegistry, since a
 * language server descriptor is pure configuration data (binary + args),
 * not a runtime callback. No activation required: an extension doesn't
 * even need code to add a language, just a manifest entry.
 */
export class LanguageServerRegistry implements IExtensionLanguageServerProvider {
  static readonly inject = [IExtensionHostService, IDatabaseService, ILogService] as const;
  constructor(
    private readonly extensionHostService: IExtensionHostService,
    private readonly databaseService: IDatabaseService,
    private readonly logService: ILogService,
  ) {}

  list(): ResolvedLanguageServerContribution[] {
    const disabledIds = new Set(
      this.databaseService.getExtensions().filter((e) => e.is_enabled === 0).map((e) => e.id),
    );

    const result: ResolvedLanguageServerContribution[] = [];
    for (const { extensionId, value } of
      this.extensionHostService.getStaticContributions<LanguageServerContribution[]>('languageServers')) {
      if (disabledIds.has(extensionId)) continue;
      for (const entry of value) {
        const resolved = this.validate(extensionId, entry);
        if (resolved) result.push(resolved);
      }
    }
    return result;
  }

  listLanguageServers(): ResolvedLanguageServerContribution[] {
    return this.list();
  }

  private validate(extensionId: string, entry: LanguageServerContribution): ResolvedLanguageServerContribution | null {
    if (!entry?.languageId?.trim() || !entry?.binary?.trim() || !Array.isArray(entry.extensions) || entry.extensions.length === 0) {
      this.logService.error(`Extension "${extensionId}" declared an invalid languageServers contribution (missing languageId/binary/extensions) — skipping.`);
      return null;
    }
    return { extensionId, languageId: entry.languageId, binary: entry.binary, args: entry.args ?? [], extensions: entry.extensions };
  }
}
