import React, { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';
import './EditorArea.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useStatusBarStore } from '../../../store/statusBar';
import { useProblemsStore, formatProblemsSummary } from '../../../store/problems';
import { EditorGroupPane } from './EditorGroupPane';
import { useMonacoThemeSync } from './monacoTheme';
import { useInlayHintsSync } from './inlayHints';

/** Renders one independent pane per editor group (EditorGroupPane.tsx); owns only app-wide concerns: Ctrl+S and resetting status bar indicators. */
export const EditorArea: React.FC = () => {
  const { groups, activeGroupId, openTabs, activeTabPath, saveActiveTab } = useWorkspaceStore();
  const activeTab = openTabs.find((t) => t.path === activeTabPath);


  const monaco = useMonaco();
  useMonacoThemeSync(monaco);
  useInlayHintsSync(monaco);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveTab]);

  // Nothing else clears the status bar when the active tab isn't a real file — EditorGroupPane's onMount only fires for genuine file tabs.
  useEffect(() => {
    if (!activeTabPath || (activeTab && (activeTab.isDiff || activeTab.isSettings || activeTab.isRepoOverview || activeTab.isCommitDetails || activeTab.isCodeHotspots || activeTab.isBranchComparison || activeTab.isGitGraph))) {
      const { updateItemText } = useStatusBarStore.getState();
      updateItemText('cursor-pos', 'Ln 1, Col 1');
      updateItemText('language-mode', 'Plain Text');
      updateItemText('indentation', 'Spaces: 2');
      const { errorCount, warningCount } = useProblemsStore.getState();
      updateItemText('problems', formatProblemsSummary(errorCount, warningCount));
    }
    // activeTab.isDiff/isSettings can't change without activeTabPath also
    // changing, since those flags are fixed at tab-creation time.
  }, [activeTabPath]);

  return (
    <div className="sde-editor-groups-row">
      {groups.map((group) => (
        <EditorGroupPane key={group.id} group={group} isActive={group.id === activeGroupId} isOnlyGroup={groups.length === 1} />
      ))}
    </div>
  );
};
