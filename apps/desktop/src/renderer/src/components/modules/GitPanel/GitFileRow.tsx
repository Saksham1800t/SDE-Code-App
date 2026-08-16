import React, { useState } from 'react';
import './GitPanel.css';
import { GitFile } from '../../../types/git';
import type { ConflictResolution } from '../../../utils/resolveConflictMarkers';
import { GitMerge } from 'lucide-react';

interface GitFileRowProps {
  file: GitFile;
  isStaged: boolean;
  onStage?: (relativePath: string) => void;
  onUnstage?: (relativePath: string) => void;
  onDiscard?: (relativePath: string) => void;
  onResolveConflict?: (relativePath: string, resolution: ConflictResolution) => void;
  onOpenMergeEditor?: (filePath: string) => void;
  openDiff: (relativePath: string, name: string) => void;
}

// Color families match VS Code's Explorer git decorations: green for Added/Renamed/Untracked, red for Deleted/Conflict, amber for Modified.
export function getStatusMeta(statusText: string): { char: string; color: string } {
  switch (statusText) {
    case 'Added':     return { char: 'A', color: 'var(--color-success)' };
    case 'Deleted':   return { char: 'D', color: 'var(--color-danger)' };
    case 'Untracked': return { char: 'U', color: 'var(--color-success)' };
    case 'Renamed':   return { char: 'R', color: 'var(--color-success)' };
    case 'Conflict':  return { char: '!', color: 'var(--color-danger)' };
    default:          return { char: 'M', color: 'var(--color-warning)' };
  }
}

export const GitFileRow: React.FC<GitFileRowProps> = ({
  file, isStaged, onStage, onUnstage, onDiscard, onResolveConflict, onOpenMergeEditor, openDiff
}) => {
  const [hovered, setHovered] = useState(false);
  const status = getStatusMeta(file.statusText);

  return (
    <div
      onClick={() => openDiff(file.relativePath, file.name)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="sde-git-file-row"
    >
      {/* File info */}
      <div className="sde-git-file-info">
        <span className={`sde-git-file-name${file.isConflict ? ' sde-git-file-name--conflict' : ''}`}>
          {file.name}
        </span>
        <span className="sde-git-file-path">
          {file.relativePath}
        </span>
      </div>

      {/* Action buttons + status badge */}
      <div className="sde-git-file-actions">
        {/* Open File */}
        {hovered && (
          <button
            onClick={e => { e.stopPropagation(); openDiff(file.relativePath, file.name); }}
            title="Open diff"
            className="sde-git-file-action-btn"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}

        {/* Discard (unstaged only) */}
        {hovered && !isStaged && onDiscard && file.statusText !== 'Untracked' && (
          <button
            onClick={e => { e.stopPropagation(); onDiscard(file.relativePath); }}
            title="Discard changes"
            className="sde-git-file-action-btn sde-git-file-action-btn--danger"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" />
            </svg>
          </button>
        )}

        {/* Conflict resolution (conflicted files only) */}
        {file.isConflict && onResolveConflict && (
          <>
            <button
              onClick={e => { e.stopPropagation(); onResolveConflict(file.relativePath, 'current'); }}
              title="Accept Current Change"
              className="sde-git-file-action-btn"
            >
              Current
            </button>
            <button
              onClick={e => { e.stopPropagation(); onResolveConflict(file.relativePath, 'incoming'); }}
              title="Accept Incoming Change"
              className="sde-git-file-action-btn"
            >
              Incoming
            </button>
            <button
              onClick={e => { e.stopPropagation(); onResolveConflict(file.relativePath, 'both'); }}
              title="Accept Both Changes"
              className="sde-git-file-action-btn"
            >
              Both
            </button>
            {onOpenMergeEditor && (
              <button
                onClick={e => { e.stopPropagation(); onOpenMergeEditor(file.path); }}
                title="Open in Merge Editor — resolve each block individually with full-file context"
                className="sde-git-file-action-btn"
              >
                <GitMerge size={12} />
              </button>
            )}
          </>
        )}

        {/* Stage (unstaged) / Unstage (staged) */}
        {hovered && (
          <button
            onClick={e => { e.stopPropagation(); isStaged ? onUnstage?.(file.relativePath) : onStage?.(file.relativePath); }}
            title={isStaged ? 'Unstage file' : 'Stage file'}
            className={`sde-git-file-action-btn${isStaged ? ' sde-git-file-action-btn--danger' : ' sde-git-file-action-btn--success'}`}
          >
            {isStaged ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </button>
        )}

        {/* Status badge (always visible) */}
        <span
          className="sde-git-file-status-badge"
          style={{ color: status.color }}
        >
          {status.char}
        </span>
      </div>
    </div>
  );
};
