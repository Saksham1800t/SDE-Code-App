import { AlertCircle, SquareTerminal, Radio, ScrollText, Share2, Bug, GitBranchPlus } from 'lucide-react';
import { registerPanelTab } from './panelTabRegistry';
import { ProblemsPanel } from '../components/modules/ProblemsPanel/ProblemsPanel';
import { PortsPanel } from '../components/modules/PortsPanel/PortsPanel';
import { TerminalArea } from '../components/modules/TerminalArea';
import { TerminalPaneActions } from '../components/modules/TerminalArea/TerminalPaneActions';
import { OutputPanel } from '../components/modules/OutputPanel/OutputPanel';
import { ImpactReportPanel } from '../components/modules/CodeMap/ImpactReportPanel';
import { DebugPanel } from '../components/modules/DebugPanel/DebugPanel';
import { DebugPanelActions } from '../components/modules/DebugPanel/DebugPanelActions';
import { ThreadsPanel } from '../components/modules/ThreadsPanel/ThreadsPanel';
import { useProblemsStore } from '../store/problems';

/** Called once at App.tsx module scope, before first render. */
export function registerBuiltinPanelTabs(): void {
  registerPanelTab({
    id: 'problems',
    label: 'Problems',
    icon: AlertCircle,
    order: 0,
    isDefault: true,
    render: ProblemsPanel,
    useBadge: () => {
      const { errorCount, warningCount } = useProblemsStore();
      const total = errorCount + warningCount;
      return total > 0 ? total : undefined;
    },
    useBadgeVariant: () => (useProblemsStore.getState().errorCount > 0 ? 'error' : 'warning'),
  });

  registerPanelTab({
    id: 'terminal',
    label: 'Terminal',
    icon: SquareTerminal,
    order: 1,
    isDefault: true,
    render: TerminalArea,
    renderActions: TerminalPaneActions,
  });

  registerPanelTab({
    id: 'ports',
    label: 'Ports',
    icon: Radio,
    order: 2,
    isDefault: true,
    render: PortsPanel,
  });

  registerPanelTab({
    id: 'output',
    label: 'Output',
    icon: ScrollText,
    order: 3,
    isDefault: true,
    render: OutputPanel,
  });

  registerPanelTab({
    id: 'debug',
    label: 'Debug',
    icon: Bug,
    order: 5,
    isDefault: true,
    render: DebugPanel,
    renderActions: DebugPanelActions,
  });

  registerPanelTab({
    id: 'threads',
    label: 'Threads',
    icon: GitBranchPlus,
    order: 6,
    isDefault: true,
    render: ThreadsPanel,
  });

  registerPanelTab({
    id: 'impact-report',
    label: 'Impact Report',
    icon: Share2,
    order: 4,
    isDefault: true,
    render: ImpactReportPanel,
  });
}
