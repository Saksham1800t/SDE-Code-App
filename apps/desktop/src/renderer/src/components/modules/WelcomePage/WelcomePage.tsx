import React, { useEffect, useState } from 'react';
import './WelcomePage.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useCommandsStore } from '../../../store/commands';
import { usePanelLayoutStore } from '../../../store/panelLayout';
import { FolderOpen, Clock, ListChecks, Check, Command, Sparkles, Puzzle } from 'lucide-react';
import type { RecentProject, ResolvedWalkthroughContribution } from '@sde-code/protocol';
import { SdeLogoMark } from '../../common/SdeLogoMark';

const WALKTHROUGH_SETTING_KEY = 'ide-walkthrough-completed';
/** Namespaced by contributed-walkthrough id so it can't collide with the built-in checklist's own flat-array key above — stores `{ [walkthroughId]: string[] }` (completed step ids per walkthrough). */
const CONTRIBUTED_WALKTHROUGH_SETTING_KEY = 'ide-walkthrough-completed-contributed';

interface WalkthroughItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

// Scoped to actions usable pre-workspace — anything needing an open folder/file was deliberately left off.
const WALKTHROUGH_ITEMS: WalkthroughItem[] = [
  {
    id: 'command-palette',
    label: 'Open the Command Palette',
    description: 'Search every command by name — the fastest way to find anything.',
    icon: <Command size={14} />,
  },
  {
    id: 'ai-assistant',
    label: 'Try the AI Assistant',
    description: 'Chat with an AI about your code, right in the sidebar.',
    icon: <Sparkles size={14} />,
  },
];

/** Shown only when no workspace is open at all and this is the sole editor pane — a mid-tabs split pane keeps the plain "no file open" message instead. */
export const WelcomePage: React.FC = () => {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [contributed, setContributed] = useState<ResolvedWalkthroughContribution[]>([]);
  const [contributedCompleted, setContributedCompleted] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    window.api?.getRecentProjects?.(3)
      .then((projects) => { if (!cancelled) setRecent(projects); })
      .catch(() => { if (!cancelled) setRecent([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api?.getSettings?.()
      .then((settings) => {
        if (cancelled) return;
        const raw = settings?.[WALKTHROUGH_SETTING_KEY];
        const ids: string[] = raw ? JSON.parse(raw) : [];
        setCompleted(new Set(ids));

        const rawContributed = settings?.[CONTRIBUTED_WALKTHROUGH_SETTING_KEY];
        setContributedCompleted(rawContributed ? JSON.parse(rawContributed) : {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api?.getWalkthroughs?.()
      .then((walkthroughs) => { if (!cancelled) setContributed(walkthroughs); })
      .catch(() => { if (!cancelled) setContributed([]); });
    return () => { cancelled = true; };
  }, []);

  const markComplete = (id: string) => {
    setCompleted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      window.api?.setSetting?.(WALKTHROUGH_SETTING_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const markContributedStepComplete = (walkthroughId: string, stepId: string) => {
    setContributedCompleted((prev) => {
      const existing = prev[walkthroughId] ?? [];
      if (existing.includes(stepId)) return prev;
      const next = { ...prev, [walkthroughId]: [...existing, stepId] };
      window.api?.setSetting?.(CONTRIBUTED_WALKTHROUGH_SETTING_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleContributedStep = (walkthroughId: string, stepId: string, command?: string) => {
    if (command) useCommandsStore.getState().executeCommand(command);
    markContributedStepComplete(walkthroughId, stepId);
  };

  const handleOpenFolder = async () => {
    const api = window.api;
    if (api?.openFolder) {
      const proj = await api.openFolder();
      if (proj) {
        useWorkspaceStore.getState().setWorkspace(proj.name, proj.path);
      }
    }
  };

  const handleOpenRecent = (project: RecentProject) => {
    useWorkspaceStore.getState().setWorkspace(project.name, project.path);
  };

  const handleWalkthroughItem = (id: string) => {
    switch (id) {
      case 'command-palette':
        useCommandsStore.getState().executeCommand('workbench.action.showCommands');
        break;
      case 'ai-assistant':
        usePanelLayoutStore.getState().toggleRightSidebar(true);
        break;
      default:
        return;
    }
    markComplete(id);
  };

  const formatRelativeTime = (timestampMs: number): string => {
    const diffMs = Date.now() - timestampMs;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestampMs).toLocaleDateString();
  };

  const allWalkthroughDone = WALKTHROUGH_ITEMS.every((item) => completed.has(item.id));

  return (
    <div className="sde-welcome-page">
      <div className="sde-welcome-content">
        <div className="sde-welcome-header">
          <SdeLogoMark size={32} className="sde-welcome-logo" />
          <h1 className="sde-welcome-title">SDE Code</h1>
        </div>

        <button className="sde-welcome-open-btn" onClick={handleOpenFolder}>
          <FolderOpen size={15} />
          Open Folder…
        </button>

        {!allWalkthroughDone && (
          <div className="sde-welcome-walkthrough">
            <h2 className="sde-welcome-section-title">
              <ListChecks size={12} />
              Getting Started
            </h2>
            <ul className="sde-welcome-walkthrough-list">
              {WALKTHROUGH_ITEMS.map((item) => {
                const done = completed.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      className={`sde-welcome-walkthrough-item${done ? ' done' : ''}`}
                      onClick={() => handleWalkthroughItem(item.id)}
                    >
                      <span className="sde-welcome-walkthrough-check">
                        {done ? <Check size={13} /> : item.icon}
                      </span>
                      <span className="sde-welcome-walkthrough-text">
                        <span className="sde-welcome-walkthrough-label">{item.label}</span>
                        <span className="sde-welcome-walkthrough-description">{item.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {contributed.map((walkthrough) => {
          const doneIds = new Set(contributedCompleted[walkthrough.id] ?? []);
          const allDone = walkthrough.steps.every((step) => doneIds.has(step.id));
          return (
            <div className="sde-welcome-walkthrough" key={walkthrough.id}>
              <h2 className="sde-welcome-section-title">
                <Puzzle size={12} />
                {walkthrough.title}
              </h2>
              {allDone ? (
                <p className="sde-welcome-walkthrough-done">
                  <Check size={14} /> You're all set — nice work!
                </p>
              ) : (
                <ul className="sde-welcome-walkthrough-list">
                  {walkthrough.steps.map((step) => {
                    const done = doneIds.has(step.id);
                    return (
                      <li key={step.id}>
                        <button
                          className={`sde-welcome-walkthrough-item${done ? ' done' : ''}`}
                          onClick={() => handleContributedStep(walkthrough.id, step.id, step.command)}
                        >
                          <span className="sde-welcome-walkthrough-check">
                            {done ? <Check size={13} /> : <Puzzle size={14} />}
                          </span>
                          <span className="sde-welcome-walkthrough-text">
                            <span className="sde-welcome-walkthrough-label">{step.title}</span>
                            <span className="sde-welcome-walkthrough-description">{step.description}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        <div className="sde-welcome-recent">
          <h2 className="sde-welcome-section-title">
            <Clock size={12} />
            Recent
          </h2>
          {loading ? (
            <p className="sde-welcome-muted">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="sde-welcome-muted">No recent folders yet — open one to get started.</p>
          ) : (
            <ul className="sde-welcome-recent-list">
              {recent.map((project) => (
                <li key={project.id}>
                  <button className="sde-welcome-recent-item" onClick={() => handleOpenRecent(project)} title={project.path}>
                    <span className="sde-welcome-recent-name">{project.name}</span>
                    <span className="sde-welcome-recent-path">{project.path}</span>
                    <span className="sde-welcome-recent-time">{formatRelativeTime(project.lastOpened)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
