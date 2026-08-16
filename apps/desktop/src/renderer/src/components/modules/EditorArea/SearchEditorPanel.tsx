import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import './SearchEditorPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { MONACO_THEME_NAME, applyMonacoTheme } from './monacoTheme';
import { formatSearchEditorDocument } from '../../../utils/searchEditorFormat';
import type { SearchInFilesOptions, SearchFileResult } from '@sde-code/protocol';
import { RefreshCw } from 'lucide-react';

interface SearchEditorPanelProps {
  tabPath: string;
  content: string;
  query: string;
  options: SearchInFilesOptions;
  groupId: string;
}

/** A saved, re-runnable search snapshot; uses setTabContent (not updateTabContent) since it isn't a real file and shouldn't trigger auto-save. */
export const SearchEditorPanel: React.FC<SearchEditorPanelProps> = ({ tabPath, content, query, options }) => {
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders);
  const setTabContent = useWorkspaceStore((s) => s.setTabContent);
  const [rerunning, setRerunning] = useState(false);

  const handleRerun = async () => {
    const api = window.api;
    if (!api || workspaceFolders.length === 0) return;
    setRerunning(true);
    try {
      const perFolder = await Promise.all(
        workspaceFolders.map((f) => api.searchInFiles(f.path, query, options)),
      );
      const multiRoot = workspaceFolders.length > 1;
      const results: SearchFileResult[] = perFolder.flatMap((res: SearchFileResult[], i) =>
        multiRoot ? res.map((r) => ({ ...r, relativePath: `${workspaceFolders[i].name}/${r.relativePath}` })) : res,
      );
      setTabContent(tabPath, formatSearchEditorDocument(query, options, results), false);
    } catch (err) {
      console.error('Failed to re-run search:', err);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="sde-search-editor-panel">
      <div className="sde-search-editor-toolbar">
        <button
          className="sde-btn sde-btn--secondary sde-btn--sm"
          onClick={handleRerun}
          disabled={rerunning || workspaceFolders.length === 0}
        >
          <RefreshCw size={13} /> {rerunning ? 'Searching…' : 'Re-run Search'}
        </button>
      </div>
      <div className="sde-search-editor-editor">
        <Editor
          height="100%"
          theme={MONACO_THEME_NAME}
          beforeMount={(monaco) => applyMonacoTheme(monaco)}
          language="plaintext"
          value={content}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            scrollBeyondLastLine: false,
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
};
