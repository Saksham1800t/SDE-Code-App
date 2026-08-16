import type { WalkthroughContribution, ResolvedWalkthroughContribution } from '@sde-code/protocol';
import { createServiceIdentifier, IDatabaseService, ILogService } from '../../platform';
import { IExtensionHostService } from '../runtime';

export interface IWalkthroughsRegistry {
  list(): ResolvedWalkthroughContribution[];
}

export const IWalkthroughsRegistry = createServiceIdentifier<IWalkthroughsRegistry>('walkthroughsRegistry');

/** Modeled directly on SnippetsRegistry: filter disabled extensions, validate each entry, log+skip rather than throw. */
export class WalkthroughsRegistry implements IWalkthroughsRegistry {
  static readonly inject = [IExtensionHostService, IDatabaseService, ILogService] as const;
  constructor(
    private readonly extensionHostService: IExtensionHostService,
    private readonly databaseService: IDatabaseService,
    private readonly logService: ILogService,
  ) {}

  list(): ResolvedWalkthroughContribution[] {
    const disabledIds = new Set(
      this.databaseService.getExtensions().filter((e) => e.is_enabled === 0).map((e) => e.id),
    );

    const result: ResolvedWalkthroughContribution[] = [];
    for (const { extensionId, value } of
      this.extensionHostService.getStaticContributions<WalkthroughContribution[]>('walkthroughs')) {
      if (disabledIds.has(extensionId)) continue;
      for (const entry of value) {
        const resolved = this.validate(extensionId, entry);
        if (resolved) result.push(resolved);
      }
    }
    return result;
  }

  private validate(extensionId: string, entry: WalkthroughContribution): ResolvedWalkthroughContribution | null {
    if (!entry?.id?.trim() || !entry?.title?.trim() || !Array.isArray(entry.steps) || entry.steps.length === 0) {
      this.logService.error(`Extension "${extensionId}" declared an invalid walkthroughs contribution (missing id/title/steps) — skipping.`);
      return null;
    }
    for (const step of entry.steps) {
      if (!step?.id?.trim() || !step?.title?.trim()) {
        this.logService.error(`Extension "${extensionId}"'s walkthrough "${entry.id}" has an invalid step (missing id/title) — skipping the whole walkthrough.`);
        return null;
      }
    }
    return {
      extensionId,
      // Namespaced so two extensions can each declare e.g. id: "getting-started" without colliding.
      id: `${extensionId}:${entry.id}`,
      title: entry.title,
      description: entry.description,
      steps: entry.steps,
    };
  }
}
