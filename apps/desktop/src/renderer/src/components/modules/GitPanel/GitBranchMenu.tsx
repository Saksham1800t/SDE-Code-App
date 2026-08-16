import React, { useState, useEffect, useRef } from 'react';
import './GitPanel.css';
import { Pencil, Trash2, GitMerge } from 'lucide-react';

interface GitBranchMenuProps {
  currentBranch: string;
  branches: { local: string[]; remote: string[] };
  onCheckout: (name: string) => void;
  onCreate: (name: string, from?: string) => void;
  onDelete: (name: string, force?: boolean) => void;
  onRename: (oldName: string, newName: string) => void;
  onMerge: (name: string) => void;
  onClose: () => void;
}

export const GitBranchMenu: React.FC<GitBranchMenuProps> = ({
  currentBranch, branches, onCheckout, onCreate, onDelete, onRename, onMerge, onClose
}) => {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filtered = (list: string[]) =>
    list.filter(b => b.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = () => {
    if (!newBranchName.trim()) return;
    onCreate(newBranchName.trim());
    setShowCreate(false);
    setNewBranchName('');
  };

  const handleRename = (old: string) => {
    if (!renameValue.trim() || renameValue === old) { setRenaming(null); return; }
    onRename(old, renameValue.trim());
    setRenaming(null);
  };

  const BranchRow = ({ name, isRemote = false }: { name: string; isRemote?: boolean }) => {
    const isCurrent = name === currentBranch;
    return (
      <div
        className={`sde-git-branch-row${isCurrent ? ' active' : ''}`}
      >
        {renaming === name ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(name); if (e.key === 'Escape') setRenaming(null); }}
            onBlur={() => handleRename(name)}
            className="sde-git-branch-row-rename-input"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <div className="sde-git-branch-row-name-container" onClick={() => !isRemote && onCheckout(name)}>
            {isCurrent ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <span style={{ width: 10 }} />
            )}
            <span className="sde-git-branch-row-name">
              {name}
            </span>
            {isRemote && <span className="sde-git-branch-row-remote-tag">remote</span>}
          </div>
        )}

        {!isRemote && !isCurrent && renaming !== name && (
          <div className="sde-git-branch-row-actions">
            <button
              onClick={e => { e.stopPropagation(); onMerge(name); }}
              title={`Merge '${name}' into '${currentBranch}'`}
              className="sde-git-branch-row-action-btn"
            >
              <GitMerge size={12} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); setRenaming(name); setRenameValue(name); }}
              title="Rename branch"
              className="sde-git-branch-row-action-btn"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(name); }}
              title="Delete branch"
              className="sde-git-branch-row-action-btn sde-git-branch-row-action-btn--danger"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const localFiltered = filtered(branches.local);
  const remoteFiltered = filtered(branches.remote);

  return (
    <div ref={ref} className="sde-git-branch-menu">
      {/* Search */}
      <div className="sde-git-branch-menu-search">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search branches..."
          className="sde-git-branch-menu-search-input"
        />
      </div>

      {/* Branch list */}
      <div className="sde-git-branch-menu-list">
        {localFiltered.length > 0 && (
          <>
            <div className="sde-git-branch-menu-section-header">LOCAL BRANCHES</div>
            {localFiltered.map(b => <BranchRow key={b} name={b} />)}
          </>
        )}
        {remoteFiltered.length > 0 && (
          <>
            <div className="sde-git-branch-menu-section-header" style={{ marginTop: '4px' }}>REMOTE BRANCHES</div>
            {remoteFiltered.map(b => <BranchRow key={b} name={b} isRemote />)}
          </>
        )}
        {localFiltered.length === 0 && remoteFiltered.length === 0 && (
          <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>No branches found</div>
        )}
      </div>

      {/* Create branch */}
      <div className="sde-git-branch-menu-create">
        {showCreate ? (
          <div className="sde-git-branch-create-input-row">
            <input
              autoFocus
              value={newBranchName}
              onChange={e => setNewBranchName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
              placeholder="New branch name..."
              className="sde-git-branch-create-input"
            />
            <button onClick={handleCreate} className="sde-git-branch-create-btn">
              Create
            </button>
          </div>
        ) : (
          <button onClick={() => setShowCreate(true)} className="sde-git-branch-create-toggle-btn">
            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>+</span>
            Create new branch...
          </button>
        )}
      </div>
    </div>
  );
};
