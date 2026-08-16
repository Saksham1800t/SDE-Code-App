import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import './CommitDetails.css';
import { useGitStore, type GitCommitFile } from '../../../store/git';
import { useWorkspaceStore } from '../../../store/workspace';
import { getStatusMeta } from '../GitPanel/GitFileRow';
import { MONACO_THEME_NAME, applyMonacoTheme } from '../EditorArea/monacoTheme';

interface MultiFileDiffViewProps {
  hash: string;
  files: GitCommitFile[];
}

interface DiffState {
  original: string;
  modified: string;
}

/** Sized to the longer side's line count, capped so long diffs get Monaco's own scrollbar instead of pushing the page out. */
function estimateHeight(diff: DiffState | undefined): number {
  if (!diff) return 120;
  const lines = Math.max(diff.original.split('\n').length, diff.modified.split('\n').length);
  return Math.min(Math.max(lines * 19 + 20, 120), 500);
}

/** "View All Changes" mode for CommitDetailsPanel — stacks every changed file's diff in one scrollable, read-only column instead of a click-per-file editor tab. */
export const MultiFileDiffView: React.FC<MultiFileDiffViewProps> = ({ hash, files }) => {
  const { gitFetchCommitFileDiff } = useGitStore();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const [diffs, setDiffs] = useState<Record<string, DiffState> | null>(null);

  useEffect(() => {
    if (!workspacePath) return;
    let cancelled = false;
    setDiffs(null);
    Promise.all(
      files.map((f) => gitFetchCommitFileDiff(workspacePath, hash, f.path).then((d) => [f.path, d] as const)),
    ).then((entries) => {
      if (cancelled) return;
      setDiffs(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [hash, files, workspacePath]);

  const registerTheme = (monaco: any) => applyMonacoTheme(monaco);

  if (diffs === null) {
    return <div className="sde-commit-details-loading">Loading all diffs…</div>;
  }

  return (
    <div className="sde-multi-file-diff">
      {files.map((file) => {
        const status = getStatusMeta(file.statusText);
        const diff = diffs[file.path];
        return (
          <div key={file.path} className="sde-multi-file-diff-block">
            <div className="sde-multi-file-diff-header">
              <span className="sde-commit-details-file-status" style={{ color: status.color }}>{status.char}</span>
              <span className="sde-multi-file-diff-path">
                {file.fromPath ? `${file.fromPath} → ${file.path}` : file.path}
              </span>
              <span className="sde-commit-details-file-stats">
                <span className="sde-commit-details-file-ins">+{file.insertions}</span>
                <span className="sde-commit-details-file-del">-{file.deletions}</span>
              </span>
            </div>
            <div className="sde-multi-file-diff-editor">
              <DiffEditor
                height={estimateHeight(diff)}
                theme={MONACO_THEME_NAME}
                beforeMount={registerTheme}
                original={diff?.original ?? ''}
                modified={diff?.modified ?? ''}
                options={{
                  readOnly: true,
                  originalEditable: false,
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  renderSideBySide: true,
                  padding: { top: 6, bottom: 6 },
                  glyphMargin: false,
                  folding: false,
                  // Lets the mouse wheel fall through to the shared scroll column once this editor hits the top/bottom of its own viewport.
                  scrollbar: { alwaysConsumeMouseWheel: false },
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
