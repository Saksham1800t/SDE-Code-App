/** Declarative `contributes.walkthroughs` — an extension "Getting Started" category on the Welcome page, read the same static way as snippets. */
export interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  /** Command id to run when this step is clicked (same id space as the Command Palette) — omitted for a purely informational step that's just marked done on click. */
  command?: string;
}

export interface WalkthroughContribution {
  id: string;
  title: string;
  description?: string;
  steps: WalkthroughStep[];
}

/** What WalkthroughsRegistry.list() hands back after validating a manifest's raw contribution — `id` is namespaced by extension so two extensions can't collide. */
export interface ResolvedWalkthroughContribution {
  extensionId: string;
  id: string;
  title: string;
  description?: string;
  steps: WalkthroughStep[];
}
