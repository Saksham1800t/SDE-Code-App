import React, { useState } from 'react';
import './GitPanel.css';
import { GitBranchMenu } from './GitBranchMenu';
import { GitMoreMenu } from './GitMoreMenu';
import { GitBranches } from '../../../types/git';
import { customPrompt } from '../../../store/prompt';
import {
  Download, ArrowDown, ArrowUp, RefreshCw, ArrowUpToLine, GitBranch as GitBranchIcon,
  Undo2, Archive, ArchiveRestore, BarChart3, Flame, GitCompare, GitGraph,
} from 'lucide-react';

interface IconBtnProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}

const IconBtn: React.FC<IconBtnProps> = ({ onClick, title, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="sde-git-file-action-btn"
    style={{ border: '1px solid var(--border-color)', padding: '4px 6px', opacity: disabled ? 0.5 : 1 }}
  >
    {children}
  </button>
);

interface GitActionsHeaderProps {
  branch: string;
  ahead: number;
  behind: number;
  loading: boolean;
  branches: GitBranches | null;
  isNotMain: boolean;
  handlePull: () => void;
  handlePush: () => void;
  handleFetch: () => void;
  loadGitStatus: () => void;
  onCheckoutBranch: (name: string) => void;
  onCreateBranch: (name: string, from?: string) => void;
  onDeleteBranch: (name: string, force?: boolean) => void;
  onRenameBranch: (oldName: string, newName: string) => void;
  onMergeBranch: (name: string) => void;
  onPublishBranch: (name: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void;
  onStashPush: () => void;
  onStashPop: () => void;
  onCreatePR: () => void;
  onOpenRepoOverview: () => void;
  onOpenCodeHotspots: () => void;
  onOpenBranchComparison: () => void;
  onOpenGitGraph: () => void;
}

export const GitActionsHeader: React.FC<GitActionsHeaderProps> = ({
  branch, ahead, behind, loading, branches, isNotMain,
  handlePull, handlePush, handleFetch, loadGitStatus,
  onCheckoutBranch, onCreateBranch, onDeleteBranch, onRenameBranch, onMergeBranch, onPublishBranch,
  onStageAll, onUnstageAll, onDiscardAll, onStashPush, onStashPop, onCreatePR,
  onOpenRepoOverview, onOpenCodeHotspots, onOpenBranchComparison, onOpenGitGraph,
}) => {
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const moreMenuGroups = [
    {
      items: [
        { label: 'Fetch', icon: <Download size={14} />, onClick: handleFetch },
        { label: 'Pull', icon: <ArrowDown size={14} />, onClick: handlePull },
        { label: 'Push', icon: <ArrowUp size={14} />, onClick: handlePush },
        { label: 'Sync (Pull + Push)', icon: <RefreshCw size={14} />, onClick: async () => { await handlePull(); await handlePush(); } },
      ]
    },
    {
      items: [
        { label: 'Publish Branch', icon: <ArrowUpToLine size={14} />, onClick: () => onPublishBranch(branch) },
        { label: 'Create Branch…', icon: <GitBranchIcon size={14} />, onClick: async () => { const n = await customPrompt('New branch name:', { title: 'Create Branch' }); if (n) onCreateBranch(n); } },
        { label: 'Create Pull Request', icon: <GitBranchIcon size={14} />, onClick: onCreatePR, disabled: !isNotMain },
      ]
    },
    {
      items: [
        { label: 'Stage All Changes', icon: '+', onClick: onStageAll },
        { label: 'Unstage All Changes', icon: '-', onClick: onUnstageAll },
        { label: 'Discard All Changes', icon: <Undo2 size={14} />, onClick: onDiscardAll, danger: true },
      ]
    },
    {
      items: [
        { label: 'Stash All Changes', icon: <Archive size={14} />, onClick: onStashPush },
        { label: 'Pop Latest Stash', icon: <ArchiveRestore size={14} />, onClick: onStashPop },
      ]
    },
    {
      items: [
        { label: 'Repository Overview', icon: <BarChart3 size={14} />, onClick: onOpenRepoOverview },
        { label: 'Code Hotspots', icon: <Flame size={14} />, onClick: onOpenCodeHotspots },
        { label: 'Compare Branches', icon: <GitCompare size={14} />, onClick: onOpenBranchComparison },
        { label: 'Git Graph', icon: <GitGraph size={14} />, onClick: onOpenGitGraph },
      ]
    }
  ];

  return (
    <div className="sde-git-actions-header">
      {/* Row 1: Branch + sync indicators */}
      <div className="sde-git-header-row-1">
        <div className="sde-git-branch-selector">
          {/* Git branch icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            <path d="M18 15V9a4 4 0 0 0-4-4H9" /><line x1="6" y1="9" x2="6" y2="15" />
          </svg>

          {/* Clickable branch name */}
          <button
            onClick={() => setBranchMenuOpen(o => !o)}
            className={`sde-git-branch-btn${branchMenuOpen ? ' active' : ''}`}
          >
            {branch}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={`sde-git-branch-arrow${branchMenuOpen ? ' sde-git-branch-arrow--open' : ''}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Ahead/behind indicators */}
          {(ahead > 0 || behind > 0) && (
            <div className="sde-git-sync-indicators">
              {behind > 0 && <span title={`${behind} commits behind`} className="sde-git-sync-behind"><ArrowDown size={11} />{behind}</span>}
              {ahead > 0 && <span title={`${ahead} commits ahead`} className="sde-git-sync-ahead"><ArrowUp size={11} />{ahead}</span>}
            </div>
          )}

          {/* Branch menu */}
          {branchMenuOpen && branches && (
            <GitBranchMenu
              currentBranch={branch}
              branches={{ local: branches.local, remote: branches.remote }}
              onCheckout={(name) => { onCheckoutBranch(name); setBranchMenuOpen(false); }}
              onCreate={(name, from) => { onCreateBranch(name, from); setBranchMenuOpen(false); }}
              onDelete={onDeleteBranch}
              onRename={onRenameBranch}
              onMerge={(name) => { onMergeBranch(name); setBranchMenuOpen(false); }}
              onClose={() => setBranchMenuOpen(false)}
            />
          )}
        </div>

        {/* PR button */}
        {isNotMain && (
          <button
            onClick={onCreatePR}
            title="Create Pull Request"
            className="sde-git-pr-btn"
          >
            <GitBranchIcon size={12} /> PR
          </button>
        )}
      </div>

      {/* Row 2: Action buttons */}
      <div className="sde-git-header-row-2">
        <IconBtn onClick={handlePull} title="Pull changes" disabled={loading}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
          </svg>
        </IconBtn>
        <IconBtn onClick={handlePush} title="Push changes" disabled={loading}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </svg>
        </IconBtn>
        <IconBtn onClick={handleFetch} title="Fetch from remote" disabled={loading}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </IconBtn>
        <IconBtn onClick={loadGitStatus} title="Refresh status" disabled={loading}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </IconBtn>

        {/* More actions */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            onClick={() => setMoreMenuOpen(o => !o)}
            title="More actions"
            className="sde-git-file-action-btn"
            style={{ border: '1px solid var(--border-color)', padding: '4px 6px' }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '1px', lineHeight: 1 }}>···</span>
          </button>
          {moreMenuOpen && (
            <GitMoreMenu groups={moreMenuGroups} onClose={() => setMoreMenuOpen(false)} />
          )}
        </div>
      </div>
    </div>
  );
};
