import React, { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import './MergeEditor.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useGitStore } from '../../../store/git';
import { parseConflictBlocks, substituteBlocks, registerConflictResolutionProvider } from './conflictResolution';
import { MONACO_THEME_NAME, applyMonacoTheme } from './monacoTheme';
import { customAlert } from '../../../store/alerts';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface MergeEditorPanelProps {
  filePath: string;
  groupId: string;
}


function withSuffix(filePath: string, suffix: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot === -1 ? `${filePath}.${suffix}` : `${filePath.slice(0, dot)}.${suffix}${filePath.slice(dot)}`;
}

const READ_ONLY_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  scrollBeyondLastLine: false,
  padding: { top: 6, bottom: 6 },
  glyphMargin: false,
  folding: false,
} as const;


export const MergeEditorPanel: React.FC<MergeEditorPanelProps> = ({ filePath, groupId }) => {
  const { closeFile, setTabContent, workspacePath } = useWorkspaceStore();
  const { gitStage } = useGitStore();
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    window.api
      ?.readFile(filePath)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch((err) => console.error('Failed to load file for merge editor:', err));
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const blocks = useMemo(() => parseConflictBlocks(content ?? ''), [content]);
  const incomingContent = useMemo(() => substituteBlocks(content ?? '', blocks, 'theirs'), [content, blocks]);
  const currentContent = useMemo(() => substituteBlocks(content ?? '', blocks, 'ours'), [content, blocks]);

  const registerTheme = (monaco: any) => {
    applyMonacoTheme(monaco);
    registerConflictResolutionProvider(monaco);
  };

  const mergeEditorPath = `merge-editor:${filePath}`;
  const handleClose = () => closeFile(mergeEditorPath, { groupId });

  const handleSaveAndClose = async () => {
    if (content === null) return;
    setSaving(true);
    try {
      const api = window.api;
      if (!api) return;
      await api.writeFile(filePath, content);
      setTabContent(filePath, content, false);

      if (blocks.length === 0 && workspacePath) {
        const normalizedFile = filePath.replace(/\\/g, '/');
        const normalizedWorkspace = workspacePath.replace(/\\/g, '/');
        const relativePath = normalizedFile.startsWith(`${normalizedWorkspace}/`)
          ? normalizedFile.slice(normalizedWorkspace.length + 1)
          : normalizedFile;
        await gitStage(relativePath, workspacePath);
      }
      handleClose();
    } catch (err: any) {
      customAlert(err?.message || 'Failed to save merged file.');
    } finally {
      setSaving(false);
    }
  };

  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  if (content === null) {
    return <div className="sde-merge-editor-loading">Loading {fileName}…</div>;
  }

  return (
    <div className="sde-merge-editor">
      <div className="sde-merge-editor-toolbar">
        <span className="sde-merge-editor-filename">{fileName}</span>
        {blocks.length === 0 ? (
          <span className="sde-merge-editor-status sde-merge-editor-status--resolved">
            <CheckCircle2 size={13} /> All conflicts resolved
          </span>
        ) : (
          <span className="sde-merge-editor-status sde-merge-editor-status--pending">
            <AlertTriangle size={13} /> {blocks.length} conflict{blocks.length === 1 ? '' : 's'} remaining
          </span>
        )}
        <div className="sde-merge-editor-actions">
          <button className="sde-btn sde-btn--primary sde-btn--sm" onClick={handleSaveAndClose} disabled={saving}>
            {saving ? 'Saving…' : 'Save & Close'}
          </button>
          <button className="sde-btn sde-btn--secondary sde-btn--sm" onClick={handleClose}>
            <X size={12} /> Close
          </button>
        </div>
      </div>

      <div className="sde-merge-editor-panes">
        <div className="sde-merge-editor-pane">
          <div className="sde-merge-editor-pane-label">Incoming</div>
          <Editor
            height="100%"
            theme={MONACO_THEME_NAME}
            beforeMount={registerTheme}
            value={incomingContent}
            options={READ_ONLY_OPTIONS}
          />
        </div>
        <div className="sde-merge-editor-pane sde-merge-editor-pane--result">
          <div className="sde-merge-editor-pane-label">Result — editable (use the Accept Current/Incoming/Both buttons above each block)</div>
          <Editor
            height="100%"
            theme={MONACO_THEME_NAME}
            beforeMount={registerTheme}
            path={withSuffix(filePath, 'merge-result')}
            value={content}
            onChange={(value) => setContent(value ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              scrollBeyondLastLine: false,
              padding: { top: 6, bottom: 6 },
            }}
          />
        </div>
        <div className="sde-merge-editor-pane">
          <div className="sde-merge-editor-pane-label">Current</div>
          <Editor
            height="100%"
            theme={MONACO_THEME_NAME}
            beforeMount={registerTheme}
            value={currentContent}
            options={READ_ONLY_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
};
