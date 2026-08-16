import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Static config, not reactive state — reactive derivations (pinned/order/active) live in store/panelTabs.ts instead. */
export interface PanelTabActionsProps {
  isActive: boolean;
}

export interface PanelTabDescriptor {
  /** Stable id, persisted in settings — never rename once shipped. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Default order before any user reorder is applied. */
  order: number;
  isDefault: boolean;
  /** Renders this tab's pane content. */
  render: ComponentType<Record<string, never>>;
  /** Badge count, or undefined/0 for none. A hook so React's normal subscription model drives re-renders. */
  useBadge?: () => number | undefined;
  /** Only invoked when useBadge() > 0. */
  useBadgeVariant?: () => 'error' | 'warning' | 'info';
  /** This tab's own per-view toolbar actions (e.g. Terminal's New/Kill) — only rendered while active. */
  renderActions?: ComponentType<PanelTabActionsProps>;
}

/** useBadge/useBadgeVariant are normalized to real functions at registration so consumers can call them unconditionally (Rules of Hooks). */
export type RegisteredPanelTab = PanelTabDescriptor & {
  useBadge: () => number | undefined;
  useBadgeVariant: () => 'error' | 'warning' | 'info';
};

export const panelTabRegistry: RegisteredPanelTab[] = [];

export function registerPanelTab(descriptor: PanelTabDescriptor): void {
  if (panelTabRegistry.some((t) => t.id === descriptor.id)) {
    console.warn(`[panelTabRegistry] duplicate tab id "${descriptor.id}" ignored`);
    return;
  }
  panelTabRegistry.push({
    ...descriptor,
    useBadge: descriptor.useBadge ?? (() => undefined),
    useBadgeVariant: descriptor.useBadgeVariant ?? (() => 'info'),
  });
}

export function getPanelTabRegistry(): RegisteredPanelTab[] {
  return panelTabRegistry;
}
