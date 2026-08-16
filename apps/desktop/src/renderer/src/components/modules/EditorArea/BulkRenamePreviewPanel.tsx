import React from 'react';
import { DiffEditor } from '@monaco-editor/react';
import './BulkRenamePreviewPanel.css';
import '../CommitDetails/CommitDetails.css';
import { useBulkRenameStore } from '../../../store/bulkRename';
import { MONACO_THEME_NAME, applyMonacoTheme } from './monacoTheme';
import { Button } from '../../common/Button';
import { Check } from 'lucide-react';

function estimateHeight(text: string | undefined): number {
  if (!text) return 120;
  const lines = text.split('\n').length;
  return Math.min(Math.max(lines * 19 + 20, 120), 500);
}

/** Preview + apply UI for "Rename Symbol (Preview)" — like CommitDetails' stacked-diff scaffold, but the "after" side is editable per block. */
export const BulkRenamePreviewPanel: React.FC = () => {
  const { loading, oldName, newName, files, applying, toggleFileIncluded, updateFileNewText, applyRename } = useBulkRenameStore();

  const registerTheme = (monaco: any) => applyMonacoTheme(monaco);

  const handleApply = async () => {
    const { appliedCount } = await applyRename();
    if (appliedCount === 0) return;
  };

  const includedCount = files.filter((f) => f.included).length;

  return (
    <div className="sde-bulk-rename-panel">
      <div className="sde-bulk-rename-container">
        <div className="sde-commit-details-title">Rename Preview</div>

        {oldName && newName && (
          <div className="sde-bulk-rename-summary">
            Renaming <code>{oldName}</code> to <code>{newName}</code>
            {files.length > 0 && ` across ${files.length} file${files.length !== 1 ? 's' : ''}`}
          </div>
        )}

        {loading ? (
          <div className="sde-commit-details-loading">Finding rename locations…</div>
        ) : files.length === 0 ? (
          <div className="sde-commit-details-empty">No files to rename.</div>
        ) : (
          <>
            <div className="sde-bulk-rename-toolbar">
              <Button variant="primary" size="sm" disabled={includedCount === 0 || applying} onClick={handleApply}>
                <Check size={13} /> {applying ? 'Applying…' : `Apply Selected (${includedCount})`}
              </Button>
            </div>

            <div className="sde-multi-file-diff">
              {files.map((file) => (
                <div key={file.filePath} className="sde-multi-file-diff-block">
                  <div className="sde-multi-file-diff-header">
                    <input
                      type="checkbox"
                      checked={file.included}
                      onChange={() => toggleFileIncluded(file.filePath)}
                      className="sde-bulk-rename-checkbox"
                    />
                    <span className="sde-multi-file-diff-path">{file.filePath}</span>
                    <span className="sde-commit-details-file-stats">
                      {file.locationCount} location{file.locationCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="sde-multi-file-diff-editor">
                    <DiffEditor
                      height={estimateHeight(file.newText)}
                      theme={MONACO_THEME_NAME}
                      beforeMount={registerTheme}
                      original={file.originalText}
                      modified={file.newText}
                      onMount={(editor) => {
                        editor.getModifiedEditor().onDidChangeModelContent(() => {
                          updateFileNewText(file.filePath, editor.getModifiedEditor().getValue());
                        });
                      }}
                      options={{
                        readOnly: false,
                        originalEditable: false,
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        renderSideBySide: true,
                        padding: { top: 6, bottom: 6 },
                        glyphMargin: false,
                        folding: false,
                        scrollbar: { alwaysConsumeMouseWheel: false },
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
