import React, { useEffect } from 'react';
import './GitPanel.css';
import { useAuthStore } from '../../../store/auth';
import { useSyncStore } from '../../../store/sync';
import { relativeTime } from '../../../utils/relativeTime';
import { CloudUpload, CloudDownload, X } from 'lucide-react';

interface EditSessionsPanelProps {
  workspacePath: string;
}

/** "Edit Sessions" — Cloud Sync of uncommitted changes, same interaction shape as stash but synced through the cloud; renders nothing if signed out. */
export const EditSessionsPanel: React.FC<EditSessionsPanelProps> = ({ workspacePath }) => {
  const token = useAuthStore((s) => s.token);
  const {
    pendingChangesAvailable, pushingPendingChanges, applyingPendingChanges, error,
    checkPendingChanges, pushPendingChanges, applyPendingChanges, dismissPendingChanges,
  } = useSyncStore();

  useEffect(() => {
    if (token && workspacePath) checkPendingChanges(workspacePath);
  }, [token, workspacePath, checkPendingChanges]);

  if (!token) return null;

  const hasPending = pendingChangesAvailable?.folderKey === workspacePath;

  return (
    <div className="sde-edit-sessions">
      {hasPending && (
        <div className="sde-edit-sessions-banner">
          <div className="sde-edit-sessions-banner-text">
            Pending changes available from {relativeTime(pendingChangesAvailable!.updatedAt)}
          </div>
          <div className="sde-edit-sessions-banner-actions">
            <button
              className="sde-btn sde-btn--secondary sde-btn--sm"
              disabled={applyingPendingChanges}
              onClick={() => dismissPendingChanges(workspacePath)}
              title="Dismiss without applying"
            >
              <X size={12} />
            </button>
            <button
              className="sde-btn sde-btn--primary sde-btn--sm"
              disabled={applyingPendingChanges}
              onClick={() => applyPendingChanges(workspacePath)}
            >
              <CloudDownload size={13} /> {applyingPendingChanges ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>
      )}

      <button
        className="sde-edit-sessions-backup-btn"
        disabled={pushingPendingChanges}
        onClick={() => pushPendingChanges(workspacePath)}
        title="Sync your current uncommitted changes to the cloud, so you can pick them up from another session"
      >
        <CloudUpload size={13} /> {pushingPendingChanges ? 'Syncing…' : 'Backup Uncommitted Changes'}
      </button>
      {error && <div className="sde-edit-sessions-error">{error}</div>}
    </div>
  );
};
