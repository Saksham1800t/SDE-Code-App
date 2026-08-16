import type { DebugAdapterContribution, ResolvedDebugAdapterContribution } from '@sde-code/protocol';
import { createServiceIdentifier, IDatabaseService, ILogService, type IExtensionDebugAdapterProvider } from '../../platform';
import { IExtensionHostService } from '../runtime';

export const IDebugAdapterRegistry = createServiceIdentifier<IExtensionDebugAdapterProvider & { list(): ResolvedDebugAdapterContribution[] }>('debugAdapterRegistry');

/**
 * Extension-contributed debug adapters, declared statically via
 * `contributes.debugAdapters` — same shape and reasoning as
 * LanguageServerRegistry: pure configuration data, no activation required.
 */
export class DebugAdapterRegistry implements IExtensionDebugAdapterProvider {
  static readonly inject = [IExtensionHostService, IDatabaseService, ILogService] as const;
  constructor(
    private readonly extensionHostService: IExtensionHostService,
    private readonly databaseService: IDatabaseService,
    private readonly logService: ILogService,
  ) {}

  list(): ResolvedDebugAdapterContribution[] {
    const disabledIds = new Set(
      this.databaseService.getExtensions().filter((e) => e.is_enabled === 0).map((e) => e.id),
    );

    const result: ResolvedDebugAdapterContribution[] = [];
    for (const { extensionId, value } of
      this.extensionHostService.getStaticContributions<DebugAdapterContribution[]>('debugAdapters')) {
      if (disabledIds.has(extensionId)) continue;
      for (const entry of value) {
        const resolved = this.validate(extensionId, entry);
        if (resolved) result.push(resolved);
      }
    }
    return result;
  }

  listDebugAdapters(): ResolvedDebugAdapterContribution[] {
    return this.list();
  }

  private validate(extensionId: string, entry: DebugAdapterContribution): ResolvedDebugAdapterContribution | null {
    if (!entry?.languageId?.trim() || !entry?.binary?.trim()) {
      this.logService.error(`Extension "${extensionId}" declared an invalid debugAdapters contribution (missing languageId/binary) — skipping.`);
      return null;
    }
    return { extensionId, languageId: entry.languageId, binary: entry.binary, args: entry.args ?? [] };
  }
}
