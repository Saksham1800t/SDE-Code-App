import React, { useEffect, useState } from 'react';
import './TimelinePanel.css';
import { ChevronRight, ChevronDown, Clock, GitCommit as GitCommitIcon, Camera } from 'lucide-react';
import { useWorkspaceStore } from '../../../store/workspace';
import { useGitStore } from '../../../store/git';
import { relativeTime } from '../../../utils/relativeTime';

type TimelineEntry =
  | { kind: 'commit'; key: string; timestamp: number; hash: string; message: string; author: string }
  | { kind: 'snapshot'; key: string; timestamp: number; id: string };

/** Collapsible sidebar section merging git commit history and Local History snapshots for the active file into one chronological list. */
export const TimelinePanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const groups = useWorkspaceStore((s) => s.groups);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const openLocalHistorySnapshotDiff = useWorkspaceStore((s) => s.openLocalHistorySnapshotDiff);
  const { gitRepoStatus, gitFetchFileCommitHistory, gitOpenCommitFileDiff } = useGitStore();
  const [collapsed, setCollapsed] = useState(false);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);

  const activeTab = groups.flatMap((g) => g.tabs).find((t) => t.path === activeTabPath);
  const isRealFileTab =
    activeTab &&
    !activeTab.isDiff && !activeTab.isSettings && !activeTab.isRepoOverview && !activeTab.isCommitDetails &&
    !activeTab.isCodeHotspots && !activeTab.isBranchComparison && !activeTab.isGitGraph && !activeTab.isLocalHistory &&
    !activeTab.isExtensionDetails && !activeTab.isCreateExtension && !activeTab.isImagePreview && !activeTab.isMarkdownPreview &&
    !activeTab.isMergeEditor && !activeTab.isBrowserPreview && !activeTab.isGitHubItem &&
    !activeTab.isAudioPreview && !activeTab.isVideoPreview && !activeTab.isSearchEditor && !activeTab.isBulkRename;

  const filePath = isRealFileTab ? activeTab!.path : null;

  useEffect(() => {
    if (!filePath || !workspacePath || collapsed) {
      setEntries(filePath && workspacePath ? entries : null);
      return;
    }
    let cancelled = false;
    setEntries(null);

    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedWorkspace = workspacePath.replace(/\\/g, '/');
    const relativePath = normalizedFile.startsWith(`${normalizedWorkspace}/`)
      ? normalizedFile.slice(normalizedWorkspace.length + 1)
      : normalizedFile;

    Promise.all([
      gitRepoStatus?.isRepo ? gitFetchFileCommitHistory(workspacePath, relativePath) : Promise.resolve([]),
      window.api?.getFileHistory?.(workspacePath, filePath) ?? Promise.resolve([]),
    ]).then(([commits, snapshots]) => {
      if (cancelled) return;
      const merged: TimelineEntry[] = [
        ...commits.map((c): TimelineEntry => ({
          kind: 'commit',
          key: `c-${c.hash}`,
          timestamp: new Date(c.date).getTime(),
          hash: c.hash,
          message: c.message,
          author: c.author,
        })),
        ...snapshots.map((s): TimelineEntry => ({
          kind: 'snapshot',
          key: `s-${s.id}`,
          timestamp: s.timestamp,
          id: s.id,
        })),
      ].sort((a, b) => b.timestamp - a.timestamp);
      setEntries(merged);
    });

    return () => {
      cancelled = true;
    };
    // activeTab?.isDirty triggers a refetch on save, since the panel stays mounted and filePath alone won't signal a new snapshot.
  }, [filePath, workspacePath, collapsed, gitRepoStatus?.isRepo, activeTab?.isDirty]);

  if (!filePath || !workspacePath) return null;

  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  const openEntry = (entry: TimelineEntry) => {
    if (entry.kind === 'commit') {
      const normalizedFile = filePath.replace(/\\/g, '/');
      const normalizedWorkspace = workspacePath.replace(/\\/g, '/');
      const relativePath = normalizedFile.startsWith(`${normalizedWorkspace}/`)
        ? normalizedFile.slice(normalizedWorkspace.length + 1)
        : normalizedFile;
      gitOpenCommitFileDiff(entry.hash, relativePath, fileName, workspacePath);
    } else {
      openLocalHistorySnapshotDiff(entry.id, filePath, new Date(entry.timestamp).toLocaleString());
    }
  };

  return (
    <div className="sde-timeline-panel">
      <button className="sde-timeline-header" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <Clock size={13} />
        <span className="sde-timeline-header-label">TIMELINE</span>
        {entries && entries.length > 0 && <span className="sde-badge">{entries.length}</span>}
      </button>

      {!collapsed && (
        <div className="sde-timeline-body">
          {entries === null ? (
            <div className="sde-timeline-empty">Loading history…</div>
          ) : entries.length === 0 ? (
            <div className="sde-timeline-empty">No history yet for {fileName}.</div>
          ) : (
            entries.map((entry) => (
              <button key={entry.key} className="sde-timeline-item" onClick={() => openEntry(entry)}>
                {entry.kind === 'commit' ? (
                  <GitCommitIcon size={13} className="sde-timeline-item-icon sde-timeline-item-icon--commit" />
                ) : (
                  <Camera size={13} className="sde-timeline-item-icon sde-timeline-item-icon--snapshot" />
                )}
                <div className="sde-timeline-item-body">
                  <span className="sde-timeline-item-label">
                    {entry.kind === 'commit' ? entry.message : 'Local snapshot'}
                  </span>
                  <span className="sde-timeline-item-meta">
                    {entry.kind === 'commit' ? `${entry.author} · ` : ''}
                    {relativeTime(entry.timestamp)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
