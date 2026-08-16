import React, { useEffect, useState } from 'react';
import './LocalHistory.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { relativeTime } from '../../../utils/relativeTime';
import { History } from 'lucide-react';

interface LocalHistoryPanelProps {
  filePath: string;
  workspacePath: string;
}

export const LocalHistoryPanel: React.FC<LocalHistoryPanelProps> = ({ filePath, workspacePath }) => {
  const openLocalHistorySnapshotDiff = useWorkspaceStore((s) => s.openLocalHistorySnapshotDiff);
  const [entries, setEntries] = useState<{ id: string; timestamp: number }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    window.api?.getFileHistory?.(workspacePath, filePath).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, workspacePath]);

  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  return (
    <div className="sde-local-history-panel">
      <div className="sde-local-history-container">
        <div className="sde-local-history-title">
          <History size={16} /> Local History
        </div>
        <div className="sde-local-history-caption">
          Automatic snapshots of <strong>{fileName}</strong>, taken on every save — independent of git. Click an entry to compare it against the
          current file.
        </div>

        {entries === null ? (
          <div className="sde-local-history-empty">Loading history…</div>
        ) : entries.length === 0 ? (
          <div className="sde-local-history-empty">No snapshots yet — history is recorded starting from the next save.</div>
        ) : (
          <div className="sde-local-history-list">
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className="sde-local-history-row"
                onClick={() => openLocalHistorySnapshotDiff(entry.id, filePath, new Date(entry.timestamp).toLocaleString())}
              >
                <span className="sde-local-history-time">{relativeTime(entry.timestamp)}</span>
                <span className="sde-local-history-date">{new Date(entry.timestamp).toLocaleString()}</span>
                {i === 0 && <span className="sde-local-history-latest">Latest</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
