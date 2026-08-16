import React from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import type { ImpactReport } from '@sde-code/protocol';
import { useWorkspaceStore, type EditorGroup } from '../../../store/workspace';
import { useGitStore } from '../../../store/git';
import { useAgentStore } from '../../../store/agent';
import { useStatusBarStore } from '../../../store/statusBar';
import { useTerminalStore } from '../../../store/terminal';
import { useCodeMapStore } from '../../../store/codeMapStore';
import { findOwningFolder, runSuggestedTests } from '../../../utils/codeMapImpact';
import { useProblemsStore, formatProblemsSummary } from '../../../store/problems';
import { TabBar } from './TabBar';
import { SettingsPanel } from '../SettingsPanel/index';
import { ExtensionDetailsPanel, PublishForm } from '../ExtensionMarketplace/index';
import { RepoOverviewPanel } from '../RepoOverview/RepoOverviewPanel';
import { CommitDetailsPanel } from '../CommitDetails/CommitDetailsPanel';
import { CodeHotspotsPanel } from '../CodeHotspots/CodeHotspotsPanel';
import { BranchComparisonPanel } from '../BranchComparison/BranchComparisonPanel';
import { GitGraphPanel } from '../GitGraph/GitGraphPanel';
import { LocalHistoryPanel } from '../LocalHistory/LocalHistoryPanel';
import { ImagePreviewPanel } from './ImagePreviewPanel';
import { AudioPreviewPanel } from './AudioPreviewPanel';
import { VideoPreviewPanel } from './VideoPreviewPanel';
import { MarkdownPreviewPanel } from './MarkdownPreviewPanel';
import { MergeEditorPanel } from './MergeEditorPanel';
import { BrowserPreviewPanel } from './BrowserPreviewPanel';
import { GitHubItemDetailPanel } from '../GitHubPanel/GitHubItemDetailPanel';
import { SearchEditorPanel } from './SearchEditorPanel';
import { BulkRenamePreviewPanel } from './BulkRenamePreviewPanel';
import { MultibufferPanel } from './MultibufferPanel';
import { NotebookPanel } from './NotebookPanel';
import { useAuthStore } from '../../../store/auth';
import { customAlert } from '../../../store/alerts';
import { notify } from '../../../store/notifications';
import { customConfirm } from '../../../store/confirm';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';
import { parseModelines } from '../../../utils/modelines';
import { attachVimMode } from './vimMode';
import { registerInlineCompletionProvider } from './inlineCompletionProvider';
import { X, Sparkles } from 'lucide-react';
import { registerSnippetCompletionProvider } from './snippetCompletionProvider';
import { registerConflictResolutionProvider } from './conflictResolution';
import { Breadcrumbs } from './Breadcrumbs';
import { useEditorSettingsStore } from '../../../store/editorSettings';
import { attachBreakpointGutter } from '../../../debug/breakpointGutter';
import '../../../debug/debugGutter.css';
import { WelcomePage } from '../WelcomePage/WelcomePage';
import { MONACO_THEME_NAME, applyMonacoTheme } from './monacoTheme';
import { applyInlayHintsOptions } from './inlayHints';
import { registerEmmetTabAction } from './emmetExpand';
import { useOutlineStore } from '../../../store/outline';
import { InlineChatWidget } from './InlineChatWidget';

// Shared by both AI-edit banners below; renders nothing while impact is still loading or found nothing worth surfacing.
const ImpactBannerLine: React.FC<{ impact: ImpactReport | undefined; filePath: string }> = ({ impact, filePath }) => {
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders);
  const [runStatus, setRunStatus] = React.useState<'idle' | 'running'>('idle');

  if (!impact) return null;
  const affectedCount = impact.directlyImports.length + impact.matchesRoute.length;
  if (affectedCount === 0 && impact.suggestedTests.length === 0) return null;

  const handleViewDetails = () => {
    useCodeMapStore.getState().setImpactTarget(filePath);
    useTerminalStore.getState().openPanelTab('impact-report');
  };

  const handleRun = async () => {
    const owningFolder = findOwningFolder(filePath, workspaceFolders);
    if (!owningFolder || impact.suggestedTests.length === 0) return;
    setRunStatus('running');
    try {
      await runSuggestedTests(owningFolder.path, impact.suggestedTests);
    } finally {
      setRunStatus('idle');
    }
  };

  return (
    <div className="sde-ai-suggest-impact">
      <button className="sde-ai-suggest-impact-summary" onClick={handleViewDetails}>
        {affectedCount} file{affectedCount === 1 ? '' : 's'} may be affected
        {impact.suggestedTests.length > 0 && ` · ${impact.suggestedTests.length} suggested test${impact.suggestedTests.length === 1 ? '' : 's'}`}
      </button>
      {impact.suggestedTests.length > 0 && (
        <button className="sde-btn sde-btn--secondary sde-btn--sm" onClick={handleRun} disabled={runStatus === 'running'}>
          Run Suggested Tests
        </button>
      )}
    </div>
  );
};

// ─── Diff Editor Panel ──────────────────────────────────────────────────────
interface DiffEditorPanelProps {
  activeTab: { path: string; name: string; originalContent?: string; content?: string };
  groupId: string;
}

const DiffEditorPanel: React.FC<DiffEditorPanelProps> = ({ activeTab, groupId }) => {
  const { closeFile, setTabContent } = useWorkspaceStore();
  const { gitStage, gitDiscard, loadGitStatus } = useGitStore();
  const [actioning, setActioning] = React.useState<string | null>(null);

  // Four tab-path prefixes (gitdiff/gitcommitdiff/branchdiff/localhistorydiff); only gitdiff supports Stage/Discard, localhistorydiff gets Restore, and localhistorydiff's path is already absolute (not repo-relative like the others).
  const isCommitDiff = activeTab.path.startsWith('gitcommitdiff:');
  const isBranchDiff = activeTab.path.startsWith('branchdiff:');
  const isLocalHistoryDiff = activeTab.path.startsWith('localhistorydiff:');
  const relativePath = isCommitDiff
    ? activeTab.path.replace(/^gitcommitdiff:[0-9a-f]+:/, '')
    : isBranchDiff
      ? activeTab.path.replace(/^branchdiff:[^:]+:/, '')
      : isLocalHistoryDiff
        ? activeTab.path.replace(/^localhistorydiff:[^:]+:/, '')
        : activeTab.path.replace(/^gitdiff:/, '');

  const registerTheme = (monaco: any) => applyMonacoTheme(monaco);

  const handleStage = async () => {
    setActioning('stage');
    try {
      await gitStage(relativePath);
      await loadGitStatus();
      closeFile(activeTab.path, { groupId });
    } catch (err: any) {
      customAlert(DIALOG_MESSAGES.editor.failedToStage(err));
    } finally {
      setActioning(null);
    }
  };

  const handleDiscard = async () => {
    if (!(await customConfirm(DIALOG_MESSAGES.editor.confirmDiscardFileChanges(relativePath), { danger: true }))) return;
    setActioning('discard');
    try {
      await gitDiscard(relativePath);
      await loadGitStatus();
      closeFile(activeTab.path, { groupId });
    } catch (err: any) {
      customAlert(DIALOG_MESSAGES.editor.failedToDiscard(err));
    } finally {
      setActioning(null);
    }
  };

  const handleRestore = async () => {
    const fileName = relativePath.split(/[\\/]/).pop() || relativePath;
    if (!(await customConfirm(`Restore ${fileName} to this version? This overwrites the file's current content on disk.`, { danger: true }))) return;
    setActioning('restore');
    try {
      const api = window.api;
      await api.writeFile(relativePath, activeTab.originalContent || '');
      // Syncs any already-open tab so it doesn't keep showing stale pre-restore content (same reason as the AI working-set accept/reject flow).
      setTabContent(relativePath, activeTab.originalContent || '', false);
      await loadGitStatus();
      closeFile(activeTab.path, { groupId });
    } catch (err: any) {
      customAlert(err?.message || 'Failed to restore this version.');
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="sde-diff-panel">
      {/* Diff Toolbar */}
      <div className="sde-diff-toolbar">
        <div className="sde-diff-info-group">
          {/* Diff icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span className="sde-diff-filename">
            {relativePath}
          </span>
          <span className="sde-diff-badge">
            {isCommitDiff ? 'HISTORICAL DIFF' : isBranchDiff ? 'BRANCH DIFF' : isLocalHistoryDiff ? 'LOCAL HISTORY' : 'DIFF'}
          </span>
        </div>

        <div className="sde-diff-actions">
          {isLocalHistoryDiff && (
            <button
              onClick={handleRestore}
              disabled={!!actioning}
              title="Restore this version"
              className="sde-btn sde-btn--sm"
              style={{
                background: 'var(--color-warning-bg)',
                border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)',
                color: 'var(--color-warning)',
                cursor: actioning ? 'wait' : 'pointer'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/>
              </svg>
              {actioning === 'restore' ? 'Restoring…' : 'Restore this version'}
            </button>
          )}

          {!isCommitDiff && !isBranchDiff && !isLocalHistoryDiff && (
            <button
              onClick={handleStage}
              disabled={!!actioning}
              title="Stage this file"
              className="sde-btn sde-btn--sm"
              style={{
                background: 'var(--color-success-bg)',
                border: '1px solid color-mix(in srgb, var(--color-success) 35%, transparent)',
                color: 'var(--color-success)',
                cursor: actioning ? 'wait' : 'pointer'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              {actioning === 'stage' ? 'Staging…' : 'Stage File'}
            </button>
          )}

          {!isCommitDiff && !isBranchDiff && !isLocalHistoryDiff && (
            <button
              onClick={handleDiscard}
              disabled={!!actioning}
              title="Discard changes to this file"
              className="sde-btn sde-btn--sm"
              style={{
                background: 'var(--color-danger-bg)',
                border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
                color: 'var(--color-danger)',
                cursor: actioning ? 'wait' : 'pointer'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/>
              </svg>
              {actioning === 'discard' ? 'Discarding…' : 'Discard Changes'}
            </button>
          )}

          <button
            onClick={() => closeFile(activeTab.path, { groupId })}
            title="Close diff"
            className="sde-btn sde-btn--secondary sde-btn--sm"
          >
            <X size={12} /> Close
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="sde-diff-legend">
        <span className="sde-diff-legend-item" style={{ color: 'var(--color-success)' }}>
          <span className="sde-diff-legend-dot sde-diff-legend-dot--added" /> Added
        </span>
        <span className="sde-diff-legend-item" style={{ color: 'var(--color-danger)' }}>
          <span className="sde-diff-legend-dot sde-diff-legend-dot--removed" /> Removed
        </span>
        <span className="sde-diff-legend-note">← original  |  modified →</span>
      </div>

      {/* DiffEditor */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DiffEditor
          height="100%"
          theme={MONACO_THEME_NAME}
          beforeMount={registerTheme}
          original={activeTab.originalContent || ''}
          modified={activeTab.content || ''}
          options={{
            readOnly: true,
            originalEditable: false,
            fontSize: 14,
            fontFamily: 'var(--font-mono)',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderSideBySide: true,
            padding: { top: 8, bottom: 8 },
            glyphMargin: false,
            folding: false,
          }}
        />
      </div>
    </div>
  );
};

interface EditorGroupPaneProps {
  group: EditorGroup;
  /** Whether this is the focused group — keyboard shortcuts and the status bar target it. */
  isActive: boolean;
  isOnlyGroup: boolean;
}

/** One independent editor pane, multiple side by side for split-editor support; status-bar-driving effects are gated on `isActive` only. */
export const EditorGroupPane: React.FC<EditorGroupPaneProps> = ({ group, isActive, isOnlyGroup }) => {
  const { setActiveTab, closeFile, updateTabContent, setActiveEditorInstance, focusEditorGroup } = useWorkspaceStore();
  const {
    pendingAIEdits,
    applyPendingAIEdits,
    discardPendingAIEdits,
    agentWorkingSet,
    agentWorkingSetImpact,
    acceptAgentFileChange,
    rejectAgentFileChange,
  } = useAgentStore();

  const { token, user } = useAuthStore();
  const { fontSize, tabSize, wordWrap, minimapEnabled, lineNumbers, showBreadcrumbs, inlayHintsEnabled, vimModeEnabled } = useEditorSettingsStore();
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders);
  const activeTab = group.tabs.find((t) => t.path === group.activeTabPath);

  // Modelines — a per-file comment (`// vim: ts=4 et`, `// -*- tab-width: 4; -*-`) overrides the global tabSize/wordWrap for just this file.
  const modelineOverrides = React.useMemo(() => parseModelines(activeTab?.content ?? ''), [activeTab?.content]);

  // Vim Mode — every pane with a live editor instance gets real Vim keybindings; only the
  // active pane's instance is wired to the (single, shared) status bar indicator — see vimMode.ts.
  React.useEffect(() => {
    if (!vimModeEnabled || !group.editorInstance) return;
    const vimMode = attachVimMode(group.editorInstance, isActive);
    return () => vimMode.dispose();
  }, [vimModeEnabled, group.editorInstance, isActive]);

  // Outline/breadcrumb symbols; declared before the early return so hooks stay unconditional, and re-registers per tab switch since Editor's onMount only fires once per pane.
  const monaco = useMonaco();

  // Inline Chat (Ctrl+I) — closed automatically on tab switch, since its pinned target range would otherwise point at the previous tab's model.
  const [inlineChatOpen, setInlineChatOpen] = React.useState(false);
  React.useEffect(() => {
    setInlineChatOpen(false);
  }, [activeTab?.path]);

  React.useEffect(() => {
    if (!isActive || !monaco || !group.editorInstance || !activeTab) return;
    const isRealFileTab =
      !activeTab.isDiff && !activeTab.isSettings && !activeTab.isRepoOverview && !activeTab.isCommitDetails &&
      !activeTab.isCodeHotspots && !activeTab.isBranchComparison && !activeTab.isGitGraph && !activeTab.isLocalHistory &&
      !activeTab.isExtensionDetails && !activeTab.isCreateExtension && !activeTab.isImagePreview && !activeTab.isMarkdownPreview &&
      !activeTab.isMergeEditor && !activeTab.isBrowserPreview && !activeTab.isGitHubItem &&
      !activeTab.isAudioPreview && !activeTab.isVideoPreview && !activeTab.isSearchEditor && !activeTab.isBulkRename &&
      !activeTab.isMultibuffer && !activeTab.isNotebook;
    if (!isRealFileTab) {
      useOutlineStore.getState().clear();
      return;
    }
    const model = group.editorInstance.getModel();
    if (!model) return;

    const filePath = activeTab.path;
    useOutlineStore.getState().recompute(monaco, model, filePath);

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const disposable = group.editorInstance.onDidChangeModelContent(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => useOutlineStore.getState().recompute(monaco, model, filePath), 300);
    });

    return () => {
      clearTimeout(debounceTimer);
      disposable.dispose();
    };
  }, [isActive, activeTab?.path, monaco, group.editorInstance]);

  const handleFocusPane = () => {
    if (!isActive) focusEditorGroup(group.id);
  };

  // Holds the current onDidChangeMarkers listener so handleEditorWillMount can dispose the previous one before registering a new one.
  const markersListenerRef = React.useRef<{ dispose: () => void } | null>(null);
  React.useEffect(() => () => markersListenerRef.current?.dispose(), []);

  if (!group.activeTabPath || !activeTab) {
    // Welcome page only shows when there's no workspace open AND this is the sole pane — a merely-tabless split pane keeps the plain message.
    const showWelcome = isOnlyGroup && workspaceFolders.length === 0;
    return (
      <div className="sde-editor-group-pane" onMouseDownCapture={handleFocusPane}>
        <TabBar
          openTabs={group.tabs}
          activeTabPath={group.activeTabPath}
          setActiveTab={setActiveTab}
          closeFile={closeFile}
          groupId={group.id}
          isOnlyGroup={isOnlyGroup}
        />
        {showWelcome ? (
          <WelcomePage />
        ) : (
          <div className="sde-editor-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="sde-editor-empty-icon">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
            <p className="sde-editor-empty-text">Select a file from the explorer to edit</p>
          </div>
        )}
      </div>
    );
  }

  const handleEditorWillMount = (monaco: any) => {
    applyMonacoTheme(monaco);

    registerInlineCompletionProvider(monaco);
    registerSnippetCompletionProvider(monaco);
    registerConflictResolutionProvider(monaco);
    applyInlayHintsOptions(monaco, inlayHintsEnabled);

    // Inject Find/Replace widget CSS via CSS custom properties so it stays correct across theme switches without re-injecting.
    if (!document.getElementById('monaco-find-widget-override')) {
      const style = document.createElement('style');
      style.id = 'monaco-find-widget-override';
      style.textContent = `
        .monaco-editor .find-widget {
          background: var(--bg-tertiary) !important;
          border: 1px solid var(--border-color) !important;
          border-radius: var(--radius-md) !important;
          box-shadow: var(--glass-shadow) !important;
        }
        .monaco-editor .find-widget .monaco-inputbox {
          background: var(--bg-chrome) !important;
          border: 1px solid var(--border-color) !important;
          border-radius: var(--radius-sm) !important;
          color: var(--text-primary) !important;
        }
        .monaco-editor .find-widget .monaco-inputbox .wrapper {
          background: transparent !important;
        }
        .monaco-editor .find-widget .monaco-inputbox input {
          background: transparent !important;
          color: var(--text-primary) !important;
        }
        .monaco-editor .find-widget .button {
          background: transparent !important;
          border-radius: var(--radius-sm) !important;
        }
        .monaco-editor .find-widget .button:hover {
          background: color-mix(in srgb, var(--text-primary) 8%, transparent) !important;
        }
        .monaco-editor .find-widget .button.checked {
          background: color-mix(in srgb, var(--accent-cyan) 15%, transparent) !important;
          border: 1px solid color-mix(in srgb, var(--accent-cyan) 40%, transparent) !important;
        }
        .monaco-editor .find-widget .matchesCount {
          color: var(--text-secondary) !important;
        }
        .monaco-editor .find-widget .find-part .monaco-inputbox,
        .monaco-editor .find-widget .replace-part .monaco-inputbox {
          background: var(--bg-chrome) !important;
        }
        .monaco-editor .find-widget > .find-part,
        .monaco-editor .find-widget > .replace-part {
          background: transparent !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Context-menu shape CSS: defineTheme() covers colors, but border-radius/shadow/font aren't theme-color-able, so they need a scoped override too.
    if (!document.getElementById('monaco-context-menu-override')) {
      const style = document.createElement('style');
      style.id = 'monaco-context-menu-override';
      style.textContent = `
        .monaco-menu-container {
          border-radius: var(--radius-md) !important;
          box-shadow: var(--glass-shadow) !important;
        }
        .monaco-menu .monaco-action-bar.vertical {
          border-radius: var(--radius-md) !important;
          font-family: var(--font-sans) !important;
          padding: 4px !important;
        }
        .monaco-menu .action-item {
          border-radius: var(--radius-sm) !important;
        }
        .monaco-menu .action-menu-item {
          border-radius: var(--radius-sm) !important;
        }
        .monaco-menu .action-label {
          font-size: var(--font-size-base) !important;
        }
        .monaco-menu .keybinding {
          color: var(--text-muted) !important;
          opacity: 1 !important;
        }
        .monaco-menu .action-item.disabled .action-label {
          color: var(--text-muted) !important;
        }
        .monaco-menu .separator {
          border-bottom: 1px solid var(--border-color) !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Aggregates markers across every open model into the shared problems store; beforeMount reruns on every <Editor> remount, so the previous listener must be disposed first or duplicates accumulate.
    markersListenerRef.current?.dispose();
    markersListenerRef.current = monaco.editor.onDidChangeMarkers(() => {
      useProblemsStore.getState().recomputeFromMarkers(monaco);
      if (isActive) {
        const { errorCount, warningCount } = useProblemsStore.getState();
        useStatusBarStore.getState().updateItemText('problems', formatProblemsSummary(errorCount, warningCount));
      }
    });
  };

  return (
    <div className={`sde-editor-group-pane${isActive ? ' sde-editor-group-pane--active' : ''}`} onMouseDownCapture={handleFocusPane}>
      {/* Tabs Bar */}
      <TabBar
        openTabs={group.tabs}
        activeTabPath={group.activeTabPath}
        setActiveTab={setActiveTab}
        closeFile={closeFile}
        groupId={group.id}
        isOnlyGroup={isOnlyGroup}
      />

      {/* Breadcrumb path trail — only for a plain file tab, not special tabs without a real workspace-relative path */}
      {showBreadcrumbs && !activeTab.isDiff && !activeTab.isSettings && !activeTab.isRepoOverview && !activeTab.isCommitDetails
        && !activeTab.isCodeHotspots && !activeTab.isBranchComparison && !activeTab.isGitGraph && !activeTab.isLocalHistory
        && !activeTab.isMarkdownPreview && !activeTab.isMergeEditor && !activeTab.isBrowserPreview && !activeTab.isGitHubItem
        && !activeTab.isAudioPreview && !activeTab.isVideoPreview && !activeTab.isSearchEditor && !activeTab.isBulkRename
        && !activeTab.isMultibuffer && !activeTab.isNotebook && (
        <Breadcrumbs filePath={activeTab.path} />
      )}

      {/* Editor container */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {inlineChatOpen && group.editorInstance && (
          <InlineChatWidget editor={group.editorInstance} groupId={group.id} onClose={() => setInlineChatOpen(false)} />
        )}

        {pendingAIEdits && pendingAIEdits.filePath === activeTab.path && (
          <div className="sde-ai-suggest-banner">
            <div className="sde-ai-suggest-row">
              <span className="sde-ai-suggest-text">
<Sparkles size={13} /> AI suggested edits applied to this file. Review changes below.
              </span>
              <div className="sde-ai-suggest-actions">
                <button
                  onClick={applyPendingAIEdits}
                  className="sde-btn sde-btn--primary sde-btn--sm"
                >
                  Accept
                </button>
                <button
                  onClick={discardPendingAIEdits}
                  className="sde-btn sde-btn--danger sde-btn--sm"
                >
                  Discard
                </button>
              </div>
            </div>
            <ImpactBannerLine impact={pendingAIEdits.impact} filePath={pendingAIEdits.filePath} />
          </div>
        )}

        {!pendingAIEdits && agentWorkingSet[activeTab.path] && (
          <div className="sde-ai-suggest-banner">
            <div className="sde-ai-suggest-row">
              <span className="sde-ai-suggest-text">
<Sparkles size={13} /> Agent {agentWorkingSet[activeTab.path].isDeleted ? 'proposes deleting' : agentWorkingSet[activeTab.path].isNew ? 'created' : 'edited'} this file. Review changes in the working set panel.
              </span>
              <div className="sde-ai-suggest-actions">
                <button
                  onClick={() => acceptAgentFileChange(activeTab.path)}
                  className="sde-btn sde-btn--primary sde-btn--sm"
                >
                  Accept
                </button>
                <button
                  onClick={() => rejectAgentFileChange(activeTab.path)}
                  className="sde-btn sde-btn--danger sde-btn--sm"
                >
                  Reject
                </button>
              </div>
            </div>
            <ImpactBannerLine impact={agentWorkingSetImpact[activeTab.path]} filePath={activeTab.path} />
          </div>
        )}

        {activeTab.isSettings ? (
          <SettingsPanel />
        ) : activeTab.isExtensionDetails ? (
          <ExtensionDetailsPanel extensionId={activeTab.extensionId!} />
        ) : activeTab.isCreateExtension ? (
          <div className="sde-create-ext-panel">
            <div className="sde-create-ext-container">
              <h1 className="sde-create-ext-title">
                {activeTab.createExtensionTemplateType === 'snippets' ? 'Publish Snippets Extension' : 'Create New Extension'}
              </h1>
              <PublishForm
                token={token}
                user={user}
                templateType={activeTab.createExtensionTemplateType}
                sourceLanguageId={activeTab.createExtensionSourceLanguageId}
                onSuccess={(message) => {
                  notify.success(message);
                  closeFile(activeTab.path, { groupId: group.id });
                }}
              />
            </div>
          </div>
        ) : activeTab.isDiff ? (
          <DiffEditorPanel activeTab={activeTab} groupId={group.id} />
        ) : activeTab.isRepoOverview ? (
          <RepoOverviewPanel />
        ) : activeTab.isCommitDetails ? (
          <CommitDetailsPanel
            hash={activeTab.commitHash!}
            shortHash={activeTab.commitShortHash!}
            message={activeTab.commitMessage!}
            author={activeTab.commitAuthor!}
            date={activeTab.commitDate!}
          />
        ) : activeTab.isCodeHotspots ? (
          <CodeHotspotsPanel />
        ) : activeTab.isBranchComparison ? (
          <BranchComparisonPanel />
        ) : activeTab.isGitGraph ? (
          <GitGraphPanel />
        ) : activeTab.isLocalHistory ? (
          <LocalHistoryPanel filePath={activeTab.localHistoryFilePath!} workspacePath={activeTab.localHistoryWorkspacePath!} />
        ) : activeTab.isImagePreview ? (
          <ImagePreviewPanel filePath={activeTab.path} />
        ) : activeTab.isMarkdownPreview ? (
          <MarkdownPreviewPanel sourceFilePath={activeTab.markdownSourcePath!} />
        ) : activeTab.isMergeEditor ? (
          <MergeEditorPanel filePath={activeTab.mergeEditorFilePath!} groupId={group.id} />
        ) : activeTab.isBrowserPreview ? (
          <BrowserPreviewPanel url={activeTab.browserPreviewUrl!} />
        ) : activeTab.isGitHubItem ? (
          <GitHubItemDetailPanel number={activeTab.gitHubItemNumber!} isPR={activeTab.gitHubItemIsPR!} />
        ) : activeTab.isAudioPreview ? (
          <AudioPreviewPanel filePath={activeTab.path} />
        ) : activeTab.isVideoPreview ? (
          <VideoPreviewPanel filePath={activeTab.path} />
        ) : activeTab.isSearchEditor ? (
          <SearchEditorPanel
            tabPath={activeTab.path}
            content={activeTab.content}
            query={activeTab.searchEditorQuery!}
            options={activeTab.searchEditorOptions!}
            groupId={group.id}
          />
        ) : activeTab.isBulkRename ? (
          <BulkRenamePreviewPanel />
        ) : activeTab.isMultibuffer ? (
          <MultibufferPanel tabPath={activeTab.path} />
        ) : activeTab.isNotebook ? (
          <NotebookPanel filePath={activeTab.path} />
        ) : (
          <Editor
            height="100%"
            theme={MONACO_THEME_NAME}
            beforeMount={handleEditorWillMount}
            onMount={(editor, monacoInstance) => {
              setActiveEditorInstance(editor, group.id);

              // Breakpoint gutter — click to toggle, red dot + current-execution-line highlight. Disposed on editor teardown, not on tab switch (see attachBreakpointGutter's own comment on why it can't close over activeTab).
              const disposeBreakpointGutter = attachBreakpointGutter(editor);
              editor.onDidDispose(disposeBreakpointGutter);

              // Ctrl+I — Inline Chat. Registered once (not per tab-switch); reads selection/model fresh at invocation time so there's no stale-tab risk.
              editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyI, () => setInlineChatOpen(true));

              // Emmet Tab-to-expand — only claims Tab while a valid abbreviation sits before the cursor (see emmetExpand.ts).
              registerEmmetTabAction(editor, monacoInstance);

              // Only the focused pane drives status bar indicators; a background pane still tracks its own instance for when it becomes active.
              const updateInfo = () => {
                if (!isActive) return;
                const model = editor.getModel();
                if (model) {
                  const lang = model.getLanguageId();
                  const formatted = lang.charAt(0).toUpperCase() + lang.slice(1);
                  useStatusBarStore.getState().updateItemText('language-mode', formatted);

                  const opts = model.getOptions();
                  useStatusBarStore.getState().updateItemText('indentation', `Spaces: ${opts.tabSize}`);

                  const pos = editor.getPosition();
                  if (pos) {
                    useStatusBarStore.getState().updateItemText('cursor-pos', `Ln ${pos.lineNumber}, Col ${pos.column}`);
                    useOutlineStore.getState().updateCursorPosition(pos.lineNumber, pos.column);
                  }
                }
              };

              updateInfo();

              // Register dynamic update listeners
              editor.onDidChangeCursorPosition(() => updateInfo());
              editor.onDidChangeModelContent(() => updateInfo());
              editor.onDidChangeModelOptions(() => updateInfo());
              // Switching tabs swaps the model but fires none of the listeners above — without this, status bar indicators stayed frozen on the first-mounted file.
              editor.onDidChangeModel(() => updateInfo());
            }}
            path={activeTab.path} // loads parser depending on file extension
            value={activeTab.content}
            onChange={(val) => updateTabContent(activeTab.path, val || '', group.id)}
            // Without this, @monaco-editor/react disposes the model whenever <Editor> unmounts (e.g. switching to a synthetic tab), destroying undo history and TS diagnostics.
            keepCurrentModel
            options={{
              fontSize,
              fontFamily: 'var(--font-mono)',
              minimap: { enabled: minimapEnabled },
              wordWrap: modelineOverrides.wordWrap ?? wordWrap,
              lineNumbers,
              tabSize: modelineOverrides.tabSize ?? tabSize,
              insertSpaces: modelineOverrides.insertSpaces,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              // Explicit — Monaco collapses this to 0px width (no clickable breakpoint gutter at all) when nothing has rendered a glyph there yet, even though `glyphMargin` itself defaults to true; forcing it keeps the strip reserved so the very first breakpoint click has somewhere to land.
              glyphMargin: true,
              padding: { top: 8, bottom: 8 },
              inlineSuggest: { enabled: true, mode: 'subwordSmart' },
              inlayHints: { enabled: inlayHintsEnabled ? 'on' : 'off' },
              // Monaco's per-theme semanticHighlighting flag has no way to be set true via defineTheme() in the standalone editor (StandaloneThemeService hardcodes it false) — 'configuredByTheme' would silently never turn on. Forcing this true is what actually activates the semantic-tokens providers registered in lsp/lspLanguageClient.ts; coloring itself still comes from each theme's existing `rules` (Monaco matches a token's type+modifiers against the same TextMate-style scope rules as syntax highlighting), so no theme file needs new fields.
              'semanticHighlighting.enabled': true,
            }}
          />
        )}
      </div>
    </div>
  );
};
