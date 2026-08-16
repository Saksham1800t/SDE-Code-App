import React, { useState } from 'react';
import './GitPanel.css';
import { GitStash } from '../../../types/git';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';

interface GitStashPanelProps {
  stashes: GitStash[];
  onPop: (index: number) => void;
  onDrop: (index: number) => void;
  onPushNew: (message?: string) => void;
}

export const GitStashPanel: React.FC<GitStashPanelProps> = ({ stashes, onPop, onDrop, onPushNew }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showStashInput, setShowStashInput] = useState(false);
  const [stashMsg, setStashMsg] = useState('');

  if (stashes.length === 0 && !showStashInput) return null;

  return (
    <div className="sde-git-stash">
      {/* Header */}
      <div className="sde-git-stash-header">
        <div
          onClick={() => setCollapsed(c => !c)}
          className="sde-git-stash-toggle-row"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="sde-git-section-hdr-label">
            STASHES ({stashes.length})
          </span>
        </div>
        <button
          onClick={() => setShowStashInput(s => !s)}
          title="Stash all changes"
          className="sde-git-stash-add-btn"
        >
          <Archive size={13} />
        </button>
      </div>

      {showStashInput && (
        <div className="sde-git-stash-input-row">
          <input
            autoFocus
            value={stashMsg}
            onChange={e => setStashMsg(e.target.value)}
            placeholder="Stash message (optional)..."
            onKeyDown={e => {
              if (e.key === 'Enter') { onPushNew(stashMsg || undefined); setStashMsg(''); setShowStashInput(false); }
              if (e.key === 'Escape') setShowStashInput(false);
            }}
            className="sde-git-stash-input"
          />
          <button
            onClick={() => { onPushNew(stashMsg || undefined); setStashMsg(''); setShowStashInput(false); }}
            className="sde-git-stash-submit-btn"
          >
            Stash
          </button>
        </div>
      )}

      {!collapsed && stashes.map(stash => (
        <div
          key={stash.index}
          className="sde-git-stash-row"
        >
          <div className="sde-git-stash-info">
            <div className="sde-git-stash-msg">
              {stash.message}
            </div>
            <div className="sde-git-stash-name">stash@{`{${stash.index}}`}</div>
          </div>
          <div className="sde-git-stash-actions">
            <button
              onClick={() => onPop(stash.index)}
              title="Pop stash"
              className="sde-git-stash-action-btn sde-git-stash-action-btn--pop"
            >
              <ArchiveRestore size={12} /> Pop
            </button>
            <button
              onClick={() => onDrop(stash.index)}
              title="Drop stash"
              className="sde-git-stash-action-btn sde-git-stash-action-btn--drop"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
