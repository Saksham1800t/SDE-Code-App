import React, { useState, useEffect, useCallback } from 'react';
import './GitPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useGitStore } from '../../../store/git';
import { useAgentStore } from '../../../store/agent';
import { useFeatureFlagsStore } from '../../../store/featureFlags';
import { GitActionsHeader } from './GitActionsHeader';
import { GitFileRow } from './GitFileRow';
import { GitCommitForm } from './GitCommitForm';
import { EmbeddedGitGraphSection } from './EmbeddedGitGraphSection';
import { GitStashPanel } from './GitStashPanel';
import { EditSessionsPanel } from './EditSessionsPanel';
import { GitHeatmap } from './GitHeatmap';
import { AlertBanner } from '../../common/AlertBanner';
import { Button } from '../../common/Button';
import { customConfirm } from '../../../store/confirm';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';
import { oneShotAIQuery } from '../../../utils/oneShotAIQuery';
import { resolveConflictMarkers, type ConflictResolution } from '../../../utils/resolveConflictMarkers';
import { AlertTriangle, Undo2 } from 'lucide-react';

export const GitPanel: React.FC = () => {
  const { workspacePath, workspaceFolders, openRepoOverviewTab, openCodeHotspotsTab, openBranchComparisonTab, openGitGraphTab, openMergeEditorTab } = useWorkspaceStore();
  const {
    gitRepoStatus,
    gitBranches,
    gitStashes,
    repoSummaries,
    loadGitStatus,
    loadAllRepoSummaries,
    gitInitRepo,
    gitStage,
    gitUnstage,
    gitStageAll,
    gitUnstageAll,
    gitDiscard,
    gitDiscardAll,
    gitCommit,
    gitCommitAndPush,
    gitUndoLastCommit,
    gitAmendLastCommit,
    gitPush,
    gitPull,
    gitFetch,
    gitLoadBranches,
    gitCreateBranch,
    gitCheckoutBranch,
    gitDeleteBranch,
    gitRenameBranch,
    gitMergeBranch,
    gitPublishBranch,
    gitStashPush,
    gitStashPop,
    gitStashDrop,
    gitLoadStashes,
    gitGetStagedDiff,
    gitGetHeatmap,
    openDiff,
  } = useGitStore();
  const { activeAIProvider, activeAIModel } = useAgentStore();
  const { isFlagEnabled } = useFeatureFlagsStore();

  const heatmapEnabled = isFlagEnabled('git-heatmap');

  const [commitMessage, setCommitMessage] = useState('');
  const [amendMode, setAmendMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [generatingAI, setGeneratingAI] = useState(false);
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  // null = "whichever repo the active workspace folder is"; picking a repo here re-targets actions below without changing the active workspace folder.
  const [selectedRepoDir, setSelectedRepoDir] = useState<string | null>(null);
  const effectiveDir = selectedRepoDir ?? workspacePath ?? undefined;
  const isMultiRepo = repoSummaries.length > 1;

  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3500); };
  const showError = (msg: string) => { setErrorMsg(msg); setTimeout(() => setErrorMsg(''), 5000); };

  const withLoading = async (fn: () => Promise<any>, successText?: string) => {
    setLoading(true); setErrorMsg('');
    try {
      await fn();
      if (successText) showSuccess(successText);
    } catch (err: any) {
      showError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (workspacePath) {
      loadGitStatus(effectiveDir);
      gitLoadBranches(effectiveDir);
      gitLoadStashes(effectiveDir);
    }
    // Deliberately depends only on workspacePath/selectedRepoDir, not effectiveDir or the (stable) store actions.
  }, [workspacePath, selectedRepoDir]);

  // Refreshed whenever any open folder changes, not just the active one —
  // a newly-added folder's repo(s) should appear in the selector too.
  useEffect(() => {
    if (workspaceFolders.length > 0) loadAllRepoSummaries();
  }, [workspaceFolders]);

  // --- Handlers ---
  const handleInit = () => withLoading(() => gitInitRepo(effectiveDir), 'Git repository initialized!');
  const handlePull = () => withLoading(() => gitPull(effectiveDir), 'Pulled changes successfully!');
  const handlePush = () => withLoading(() => gitPush(effectiveDir), 'Pushed changes successfully!');
  const handleFetch = () => withLoading(() => gitFetch(effectiveDir), 'Fetched from remote!');

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    await withLoading(async () => {
      await gitCommit(commitMessage, effectiveDir);
      setCommitMessage('');
    }, 'Committed successfully!');
  };

  const handleCommitAndPush = async (msg: string) => {
    if (!msg.trim()) return;
    await withLoading(async () => {
      await gitCommitAndPush(msg, effectiveDir);
      setCommitMessage('');
    }, 'Committed and pushed!');
  };

  // Pure text-level resolution followed by staging, matching VS Code's "Complete Merge": accepting a resolution also marks the file resolved.
  const handleResolveConflict = (relativePath: string, resolution: ConflictResolution) => {
    const file = gitRepoStatus?.files.find((f) => f.relativePath === relativePath);
    if (!file) return;
    withLoading(async () => {
      const api = window.api;
      const content = await api.readFile(file.path);
      const resolved = resolveConflictMarkers(content, resolution);
      await api.writeFile(file.path, resolved);
      await gitStage(relativePath, effectiveDir);
    }, `Resolved ${file.name} (${resolution})`);
  };

  const handleUndoLastCommit = () => withLoading(() => gitUndoLastCommit(effectiveDir), 'Last commit undone!');
  const handleAmendLastCommit = (msg: string) => withLoading(async () => {
    await gitAmendLastCommit(msg, effectiveDir);
    setCommitMessage('');
    setAmendMode(false);
  }, 'Commit amended!');
  const handleDiscardAll = async () => {
    if (!(await customConfirm(DIALOG_MESSAGES.git.confirmDiscardAllUnstaged, { danger: true }))) return;
    withLoading(() => gitDiscardAll(effectiveDir), 'All changes discarded.');
  };
  const handleDiscard = async (relativePath: string) => {
    if (!(await customConfirm(DIALOG_MESSAGES.git.confirmDiscardFile(relativePath), { danger: true }))) return;
    withLoading(() => gitDiscard(relativePath, effectiveDir));
  };

  const handleGenerateAIMessage = useCallback(async () => {
    setGeneratingAI(true);
    try {
      const diff = await gitGetStagedDiff(effectiveDir);
      if (!diff) { showError('No staged changes to generate a message from.'); return; }

      const prompt = `You are a git commit message assistant. Generate a concise, conventional commit message for the following staged git diff.\nUse Conventional Commits format: type(scope?): description\nTypes: feat, fix, docs, style, refactor, test, chore, perf\nBe specific. Max 72 chars for subject. No markdown, no backticks, just the commit message.\n\nDiff:\n${diff.slice(0, 4000)}`;

      const result = await oneShotAIQuery(activeAIProvider, activeAIModel, prompt);

      const cleaned = result.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
      if (cleaned) setCommitMessage(cleaned);
    } catch (err: any) {
      showError('Failed to generate AI message: ' + err.message);
    } finally {
      setGeneratingAI(false);
    }
  }, [gitGetStagedDiff, activeAIProvider, activeAIModel, effectiveDir]);

  const handleCreatePR = () => {
    const remote = gitRepoStatus?.branch;
    showSuccess(`PR creation for "${remote}" — configure GitHub/GitLab token in Settings to enable.`);
  };

  if (!workspacePath) {
    return (
      <div className="sde-empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <path d="M18 15V9a4 4 0 0 0-4-4H9" /><line x1="6" y1="9" x2="6" y2="15" />
        </svg>
        <p>No workspace folder open.</p>
        <p style={{ opacity: 0.7 }}>Open a folder to view Git status.</p>
      </div>
    );
  }

  if (!gitRepoStatus || !gitRepoStatus.isRepo) {
    return (
      <div className="sde-git-panel">
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', flexShrink: 0 }}>
          <div style={{ padding: '20px', background: 'color-mix(in srgb, var(--text-primary) 2%, transparent)', border: '1px dashed var(--border-color)', borderRadius: '8px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              <path d="M18 15V9a4 4 0 0 0-4-4H9" /><line x1="6" y1="9" x2="6" y2="15" />
            </svg>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>This folder is not a Git repository.</span>
            <Button onClick={handleInit} disabled={loading} variant="primary" fullWidth>
              {loading ? 'Initializing…' : 'Initialize Git Repository'}
            </Button>
          </div>
          {errorMsg && <AlertBanner type="error" message={errorMsg} onClose={() => setErrorMsg('')} />}
        </div>
        {/* The workspace root itself isn't a repo, but may still contain nested ones — surface those instead of hiding behind "not a repo". */}
        <div className="sde-panel-scroll">
          <EmbeddedGitGraphSection workspacePath={effectiveDir ?? workspacePath} />
        </div>
      </div>
    );
  }

  const stagedFiles = gitRepoStatus.files.filter(f => f.isStaged);
  const unstagedFiles = gitRepoStatus.files.filter(f => f.isUnstaged && !f.isStaged);
  const conflictFiles = gitRepoStatus.files.filter(f => f.isConflict);
  const ahead = gitRepoStatus.ahead || 0;
  const behind = gitRepoStatus.behind || 0;
  const isNotMain = !['main', 'master'].includes(gitRepoStatus.branch);

  const SectionHeader = ({ label, count, onStageAll, onUnstageAll, onDiscardAll, collapsed, onToggle }: any) => (
    <div
      onClick={onToggle}
      className="sde-git-section-hdr"
    >
      <div className="sde-git-section-hdr-left">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
          className={`sde-git-section-hdr-arrow${collapsed ? ' sde-git-section-hdr-arrow--collapsed' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="sde-git-section-hdr-label">
          {label} ({count})
        </span>
      </div>
      <div className="sde-git-section-hdr-actions" onClick={e => e.stopPropagation()}>
        {onStageAll && count > 0 && (
          <button onClick={onStageAll} title="Stage all" className="sde-git-section-hdr-action-btn sde-git-section-hdr-action-btn--add">+</button>
        )}
        {onUnstageAll && count > 0 && (
          <button onClick={onUnstageAll} title="Unstage all" className="sde-git-section-hdr-action-btn sde-git-section-hdr-action-btn--remove">-</button>
        )}
        {onDiscardAll && count > 0 && (
          <button onClick={onDiscardAll} title="Discard all changes" className="sde-git-section-hdr-action-btn sde-git-section-hdr-action-btn--discard"><Undo2 size={12} /></button>
        )}
      </div>
    </div>
  );

  return (
    <div className="sde-git-panel">
      {/* Repo selector — only shown once more than one repo is discovered; everything below acts on whichever repo is selected here. */}
      {isMultiRepo && (
        <div className="sde-git-repo-selector">
          {repoSummaries.map((repo) => {
            const isSelected = (selectedRepoDir ?? workspacePath) === repo.dir;
            const changeCount = repo.status.files.length;
            const hasConflicts = repo.status.files.some((f) => f.isConflict);
            return (
              <button
                key={repo.dir}
                onClick={() => setSelectedRepoDir(repo.dir)}
                className={`sde-git-repo-chip${isSelected ? ' active' : ''}`}
                title={repo.dir}
              >
                {repo.name}
                {hasConflicts ? (
                  <span className="sde-git-repo-chip-badge sde-git-repo-chip-badge--conflict">!</span>
                ) : changeCount > 0 ? (
                  <span className="sde-git-repo-chip-badge">{changeCount}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <GitActionsHeader
        branch={gitRepoStatus.branch}
        ahead={ahead}
        behind={behind}
        loading={loading}
        branches={gitBranches}
        isNotMain={isNotMain}
        handlePull={handlePull}
        handlePush={handlePush}
        handleFetch={handleFetch}
        loadGitStatus={() => loadGitStatus(effectiveDir)}
        onCheckoutBranch={name => withLoading(() => gitCheckoutBranch(name, effectiveDir), `Switched to ${name}`)}
        onCreateBranch={(name, from) => withLoading(() => gitCreateBranch(name, from, effectiveDir), `Created branch ${name}`)}
        onDeleteBranch={(name, force) => withLoading(() => gitDeleteBranch(name, force, effectiveDir))}
        onRenameBranch={(old, n) => withLoading(() => gitRenameBranch(old, n, effectiveDir))}
        onMergeBranch={(name) => withLoading(() => gitMergeBranch(name, effectiveDir), `Merged ${name} into ${gitRepoStatus.branch}`)}
        onPublishBranch={name => withLoading(() => gitPublishBranch(name, effectiveDir), `Published ${name}`)}
        onStageAll={() => withLoading(() => gitStageAll(effectiveDir))}
        onUnstageAll={() => withLoading(() => gitUnstageAll(effectiveDir))}
        onDiscardAll={handleDiscardAll}
        onStashPush={() => withLoading(() => gitStashPush(undefined, effectiveDir), 'Changes stashed!')}
        onStashPop={() => withLoading(() => gitStashPop(undefined, effectiveDir), 'Stash popped!')}
        onCreatePR={handleCreatePR}
        onOpenRepoOverview={openRepoOverviewTab}
        onOpenCodeHotspots={openCodeHotspotsTab}
        onOpenBranchComparison={openBranchComparisonTab}
        onOpenGitGraph={openGitGraphTab}
      />

      {/* Alerts */}
      {successMsg && (
        <AlertBanner type="success" message={successMsg} onClose={() => setSuccessMsg('')}
          style={{ borderBottom: '1px solid rgba(63,185,80,0.15)', borderRadius: 0 }} />
      )}
      {errorMsg && (
        <AlertBanner type="error" message={errorMsg} onClose={() => setErrorMsg('')}
          style={{ borderBottom: '1px solid rgba(255,107,107,0.12)', borderRadius: 0 }} />
      )}

      {/* Scrollable middle */}
      <div className="sde-panel-scroll">
        {/* MERGE CONFLICTS */}
        {conflictFiles.length > 0 && (
          <div style={{ background: 'color-mix(in srgb, var(--color-warning) 6%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)' }}>
            <div style={{ padding: '5px 16px', fontSize: '10px', fontWeight: 700, color: 'var(--color-warning)', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={12} /> MERGE CONFLICTS ({conflictFiles.length})
              <span style={{ fontSize: '10px', fontWeight: 400, color: 'color-mix(in srgb, var(--color-warning) 70%, transparent)' }}>— resolve conflicts then commit</span>
            </div>
            {conflictFiles.map(file => (
              <GitFileRow
                key={file.path}
                file={file}
                isStaged={false}
                onStage={(relativePath) => gitStage(relativePath, effectiveDir)}
                onResolveConflict={handleResolveConflict}
                onOpenMergeEditor={openMergeEditorTab}
                openDiff={(relativePath, name) => openDiff(relativePath, name, effectiveDir)}
              />
            ))}
          </div>
        )}

        {/* STAGED CHANGES */}
        <div style={{ marginBottom: '2px' }}>
          <SectionHeader
            label="STAGED CHANGES" count={stagedFiles.length}
            onUnstageAll={() => withLoading(() => gitUnstageAll(effectiveDir))}
            collapsed={stagedCollapsed}
            onToggle={() => setStagedCollapsed(c => !c)}
          />
          {!stagedCollapsed && (
            stagedFiles.length === 0
              ? <div className="sde-muted-note">No staged changes</div>
              : stagedFiles.map(file => (
                  <GitFileRow key={file.path} file={file} isStaged={true}
                    onUnstage={(relativePath) => gitUnstage(relativePath, effectiveDir)}
                    openDiff={(relativePath, name) => openDiff(relativePath, name, effectiveDir)} />
                ))
          )}
        </div>

        {/* CHANGES */}
        <div style={{ marginBottom: '2px' }}>
          <SectionHeader
            label="CHANGES" count={unstagedFiles.length}
            onStageAll={() => withLoading(() => gitStageAll(effectiveDir))}
            onDiscardAll={handleDiscardAll}
            collapsed={changesCollapsed}
            onToggle={() => setChangesCollapsed(c => !c)}
          />
          {!changesCollapsed && (
            unstagedFiles.length === 0
              ? <div className="sde-muted-note">No unstaged changes</div>
              : unstagedFiles.map(file => (
                  <GitFileRow key={file.path} file={file} isStaged={false}
                    onStage={(relativePath) => gitStage(relativePath, effectiveDir)}
                    onDiscard={handleDiscard}
                    openDiff={(relativePath, name) => openDiff(relativePath, name, effectiveDir)} />
                ))
          )}
        </div>

        {/* STASHES */}
        <GitStashPanel
          stashes={gitStashes}
          onPop={index => withLoading(() => gitStashPop(index, effectiveDir), 'Stash popped!')}
          onDrop={index => withLoading(() => gitStashDrop(index, effectiveDir))}
          onPushNew={msg => withLoading(() => gitStashPush(msg, effectiveDir), 'Changes stashed!')}
        />

        {/* EDIT SESSIONS — cloud sync of uncommitted changes (Phase 29) */}
        {effectiveDir && <EditSessionsPanel workspacePath={effectiveDir} />}

        {/* COMMIT LOG — embedded lane graph, one section per repo found under the workspace root */}
        <EmbeddedGitGraphSection workspacePath={effectiveDir ?? workspacePath} />

        {/* ACTIVITY HEATMAP — off by default (see 'git-heatmap' in Settings > Feature Toggles) */}
        {heatmapEnabled && <GitHeatmap getHeatmap={(weeks) => gitGetHeatmap(weeks, effectiveDir)} />}
      </div>

      {/* Commit form (fixed bottom) */}
      <GitCommitForm
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        amendMode={amendMode}
        setAmendMode={setAmendMode}
        stagedCount={stagedFiles.length}
        loading={loading}
        handleCommit={handleCommit}
        handleCommitAndPush={handleCommitAndPush}
        handleUndoLastCommit={handleUndoLastCommit}
        handleAmendLastCommit={handleAmendLastCommit}
        onGenerateAIMessage={handleGenerateAIMessage}
        generatingAI={generatingAI}
      />
    </div>
  );
};
