import type { LanguageDefinitionContribution, ResolvedLanguageDefinitionContribution } from '@sde-code/protocol';
import { createServiceIdentifier, IDatabaseService, ILogService } from '../../platform';
import { IExtensionHostService } from '../runtime';

export interface ILanguageDefinitionRegistry {
  list(): ResolvedLanguageDefinitionContribution[];
}

export const ILanguageDefinitionRegistry = createServiceIdentifier<ILanguageDefinitionRegistry>('languageDefinitionRegistry');

/**
 * Extension-contributed new languages, declared statically via
 * `contributes.languages` — same shape/reasoning as LanguageServerRegistry.
 * Unlike that registry, this one has no platform/ cross-layer interface:
 * Monaco only exists in the renderer, so main process never needs to
 * consume this itself — it's exposed to the renderer purely via IPC (see
 * extensions:getLanguageDefinitions in host/ipc.ts).
 */
export class LanguageDefinitionRegistry implements ILanguageDefinitionRegistry {
  static readonly inject = [IExtensionHostService, IDatabaseService, ILogService] as const;
  constructor(
    private readonly extensionHostService: IExtensionHostService,
    private readonly databaseService: IDatabaseService,
    private readonly logService: ILogService,
  ) {}

  list(): ResolvedLanguageDefinitionContribution[] {
    const disabledIds = new Set(
      this.databaseService.getExtensions().filter((e) => e.is_enabled === 0).map((e) => e.id),
    );

    const result: ResolvedLanguageDefinitionContribution[] = [];
    for (const { extensionId, value } of
      this.extensionHostService.getStaticContributions<LanguageDefinitionContribution[]>('languages')) {
      if (disabledIds.has(extensionId)) continue;
      for (const entry of value) {
        const resolved = this.validate(extensionId, entry);
        if (resolved) result.push(resolved);
      }
    }
    return result;
  }

  private validate(extensionId: string, entry: LanguageDefinitionContribution): ResolvedLanguageDefinitionContribution | null {
    if (!entry?.languageId?.trim() || !Array.isArray(entry.extensions) || entry.extensions.length === 0) {
      this.logService.error(`Extension "${extensionId}" declared an invalid languages contribution (missing languageId/extensions) — skipping.`);
      return null;
    }
    return {
      extensionId,
      languageId: entry.languageId,
      extensions: entry.extensions,
      aliases: entry.aliases,
      monarch: entry.monarch,
      configuration: entry.configuration,
    };
  }
}
