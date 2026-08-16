import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import './GitHub.css';
import '../CommitDetails/CommitDetails.css';
import type { GitHubFileEntry } from '@sde-code/protocol';
import type { GitHubRepoRef } from '../../../utils/gitHubRepo';
import { MONACO_THEME_NAME, applyMonacoTheme } from '../EditorArea/monacoTheme';
import { useGitHubStore } from '../../../store/github';
import { relativeTime } from '../../../utils/relativeTime';
import { MessageSquarePlus, X } from 'lucide-react';

interface GitHubPRFilesViewProps {
  repo: GitHubRepoRef;
  baseSha: string;
  headSha: string;
  files: GitHubFileEntry[];
}

interface DiffState {
  original: string;
  modified: string;
}

interface ComposerTarget {
  filename: string;
  side: 'LEFT' | 'RIGHT';
  line: number;
}

function estimateHeight(diff: DiffState | undefined): number {
  if (!diff) return 120;
  const lines = Math.max(diff.original.split('\n').length, diff.modified.split('\n').length);
  return Math.min(Math.max(lines * 19 + 20, 120), 500);
}

function statusMeta(status: string): { char: string; color: string } {
  switch (status) {
    case 'added':    return { char: 'A', color: 'var(--color-success)' };
    case 'removed':  return { char: 'D', color: 'var(--color-danger)' };
    case 'renamed':  return { char: 'R', color: 'var(--color-success)' };
    case 'copied':   return { char: 'C', color: 'var(--color-success)' };
    default:         return { char: 'M', color: 'var(--color-warning)' };
  }
}

/** PR "Files changed" view: sources diffs from GitHub's Contents API at base/head SHAs; line comments render below the diff since Monaco's DiffEditor can't give precise per-pane overlay positions. */
export const GitHubPRFilesView: React.FC<GitHubPRFilesViewProps> = ({ repo, baseSha, headSha, files }) => {
  const [diffs, setDiffs] = useState<Record<string, DiffState> | null>(null);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [composerText, setComposerText] = useState('');
  const { reviewComments, draftComments, addDraftComment, removeDraftComment } = useGitHubStore();

  useEffect(() => {
    const api = window.api;
    if (!api?.githubGetFileContentAtRef) return;
    let cancelled = false;
    setDiffs(null);
    Promise.all(
      files.map(async (f) => {
        const [original, modified] = await Promise.all([
          f.status === 'added' ? Promise.resolve('') : api.githubGetFileContentAtRef(repo.owner, repo.repo, f.previousFilename || f.filename, baseSha),
          f.status === 'removed' ? Promise.resolve('') : api.githubGetFileContentAtRef(repo.owner, repo.repo, f.filename, headSha),
        ]);
        return [f.filename, { original, modified }] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setDiffs(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [repo, baseSha, headSha, files]);

  const registerTheme = (monaco: any) => applyMonacoTheme(monaco);

  const handleSubmitComment = () => {
    if (!composer) return;
    addDraftComment(composer.filename, composer.line, composer.side, composerText);
    setComposer(null);
    setComposerText('');
  };

  if (diffs === null) {
    return <div className="sde-github-empty">Loading file diffs…</div>;
  }

  return (
    <div className="sde-multi-file-diff">
      {files.map((file) => {
        const status = statusMeta(file.status);
        const diff = diffs[file.filename];
        const fileReviewComments = reviewComments.filter((c) => c.path === file.filename);
        const fileDraftComments = draftComments
          .map((c, index) => ({ ...c, index }))
          .filter((c) => c.path === file.filename);
        const hasAnnotations = fileReviewComments.length > 0 || fileDraftComments.length > 0 || composer?.filename === file.filename;

        return (
          <div key={file.filename} className="sde-multi-file-diff-block">
            <div className="sde-multi-file-diff-header">
              <span className="sde-commit-details-file-status" style={{ color: status.color }}>{status.char}</span>
              <span className="sde-multi-file-diff-path">
                {file.previousFilename ? `${file.previousFilename} → ${file.filename}` : file.filename}
              </span>
              <span className="sde-commit-details-file-stats">
                <span className="sde-commit-details-file-ins">+{file.additions}</span>
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
                onMount={(editorInstance, monacoInstance) => {
                  const isGutterClick = (e: any) =>
                    e.target.position &&
                    (e.target.type === monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
                      e.target.type === monacoInstance.editor.MouseTargetType.GUTTER_LINE_NUMBERS);

                  editorInstance.getOriginalEditor().onMouseDown((e: any) => {
                    if (!isGutterClick(e)) return;
                    setComposer({ filename: file.filename, side: 'LEFT', line: e.target.position.lineNumber });
                    setComposerText('');
                  });
                  editorInstance.getModifiedEditor().onMouseDown((e: any) => {
                    if (!isGutterClick(e)) return;
                    setComposer({ filename: file.filename, side: 'RIGHT', line: e.target.position.lineNumber });
                    setComposerText('');
                  });
                }}
                options={{
                  readOnly: true,
                  originalEditable: false,
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  renderSideBySide: true,
                  padding: { top: 6, bottom: 6 },
                  glyphMargin: true,
                  folding: false,
                  scrollbar: { alwaysConsumeMouseWheel: false },
                }}
              />
            </div>

            {hasAnnotations && (
              <div className="sde-github-review-annotations">
                {fileReviewComments.map((c) => (
                  <div key={c.id} className="sde-github-review-comment">
                    <div className="sde-github-review-comment-meta">
                      Line {c.line ?? '?'} · {c.side === 'LEFT' ? 'removed' : 'added'} · <strong>{c.author}</strong> · {relativeTime(c.createdAt)}
                    </div>
                    <div className="sde-github-review-comment-body">{c.body}</div>
                  </div>
                ))}
                {fileDraftComments.map((c) => (
                  <div key={c.index} className="sde-github-review-comment sde-github-review-comment--draft">
                    <div className="sde-github-review-comment-meta">
                      Line {c.line} · {c.side === 'LEFT' ? 'removed' : 'added'} · <span className="sde-github-pending-badge">Pending</span>
                      <button className="sde-github-review-comment-remove" onClick={() => removeDraftComment(c.index)} title="Remove">
                        <X size={12} />
                      </button>
                    </div>
                    <div className="sde-github-review-comment-body">{c.body}</div>
                  </div>
                ))}
                {composer?.filename === file.filename && (
                  <div className="sde-github-review-composer">
                    <div className="sde-github-review-comment-meta">
                      <MessageSquarePlus size={13} /> Comment on line {composer.line} ({composer.side === 'LEFT' ? 'removed' : 'added'})
                    </div>
                    <textarea
                      className="sde-github-comment-input"
                      autoFocus
                      value={composerText}
                      onChange={(e) => setComposerText(e.target.value)}
                      placeholder="Leave a comment on this line…"
                      rows={2}
                    />
                    <div className="sde-github-review-composer-actions">
                      <button className="sde-btn sde-btn--secondary sde-btn--sm" onClick={() => setComposer(null)}>Cancel</button>
                      <button className="sde-btn sde-btn--primary sde-btn--sm" disabled={!composerText.trim()} onClick={handleSubmitComment}>
                        Add Comment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
