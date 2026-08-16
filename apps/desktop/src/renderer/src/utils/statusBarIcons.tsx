import React from 'react';
import { GitBranch, Zap, Bot, Cloud, ShieldAlert, type LucideIcon } from 'lucide-react';

/** Status bar items can be contributed by extensions over IPC, which can only ship a plain string, so `StatusBarItem.icon` stays a name string looked up here. */
const STATUS_BAR_ICON_MAP: Record<string, LucideIcon> = {
  'git-branch': GitBranch,
  zap: Zap,
  bot: Bot,
  cloud: Cloud,
  'shield-alert': ShieldAlert,
};

export function renderStatusBarIcon(name: string | undefined, size = 13): React.ReactNode {
  if (!name) return null;
  const Icon = STATUS_BAR_ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}
