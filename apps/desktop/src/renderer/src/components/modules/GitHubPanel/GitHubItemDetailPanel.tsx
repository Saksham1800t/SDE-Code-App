import React, { useEffect, useState } from 'react';
import './GitHub.css';
import '../CommitDetails/CommitDetails.css';
import { useGitHubStore } from '../../../store/github';
import { GitHubPRFilesView } from './GitHubPRFilesView';
import { relativeTime } from '../../../utils/relativeTime';
import { Button } from '../../common/Button';
import { GitPullRequest, CircleDot, ExternalLink, Check, X as XIcon } from 'lucide-react';
import type { GitHubReviewEvent } from '@sde-code/protocol';

interface GitHubItemDetailPanelProps {
  number: number;
  isPR: boolean;
}

/** Detail tab for a GitHub PR or Issue, unified since both share comment-thread mechanics; only PRs get the "Files changed" section. */
export const GitHubItemDetailPanel: React.FC<GitHubItemDetailPanelProps> = ({ number, isPR }) => {
  const {
    repo, activePullRequest, activePullRequestFiles, activeIssue, comments,
    loadingDetail, postingComment, commentError,
    draftComments, submittingReview, reviewSubmitError,
    openPullRequest, openIssue, postComment, submitReview,
  } = useGitHubStore();
  const [commentBody, setCommentBody] = useState('');
  const [reviewBody, setReviewBody] = useState('');

  useEffect(() => {
    if (isPR) openPullRequest(number);
    else openIssue(number);
  }, [number, isPR, openPullRequest, openIssue]);

  const item = isPR ? activePullRequest : activeIssue;

  const handlePostComment = async () => {
    const ok = await postComment(number, commentBody);
    if (ok) setCommentBody('');
  };

  const handleSubmitReview = async (event: GitHubReviewEvent) => {
    const ok = await submitReview(event, reviewBody);
    if (ok) setReviewBody('');
  };

  if (loadingDetail || !item || !repo) {
    return <div className="sde-github-panel"><div className="sde-github-empty">Loading #{number}…</div></div>;
  }

  return (
    <div className="sde-github-item-panel">
      <div className="sde-github-item-container">
        <div className="sde-github-item-header">
          {isPR ? <GitPullRequest size={16} /> : <CircleDot size={16} />}
          <span className="sde-github-item-title">{item.title}</span>
          <a
            className="sde-github-item-external"
            onClick={() => window.api?.openExternal?.(`https://github.com/${repo.owner}/${repo.repo}/${isPR ? 'pull' : 'issues'}/${number}`)}
            title="Open on GitHub"
          >
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="sde-github-item-meta">
          #{number} · {item.state} · opened by {item.author} · {relativeTime(item.createdAt)}
          {isPR && (item as any).draft ? ' · Draft' : ''}
        </div>

        {item.body && <div className="sde-github-item-body">{item.body}</div>}

        {isPR && activePullRequest && (
          <>
            <div className="sde-commit-details-section-label">
              Files Changed{activePullRequestFiles.length ? ` (${activePullRequestFiles.length})` : ''}
            </div>
            {activePullRequestFiles.length === 0 ? (
              <div className="sde-github-empty">No file changes.</div>
            ) : (
              <GitHubPRFilesView
                repo={repo}
                baseSha={activePullRequest.baseSha}
                headSha={activePullRequest.headSha}
                files={activePullRequestFiles}
              />
            )}

            <div className="sde-github-review-toolbar">
              <div className="sde-github-review-toolbar-header">
                <span>
                  {draftComments.length === 0
                    ? 'Click a line in the diff above to add a review comment.'
                    : `${draftComments.length} pending comment${draftComments.length !== 1 ? 's' : ''}`}
                </span>
              </div>
              <textarea
                className="sde-github-comment-input"
                placeholder="Review summary (optional for Comment, shown with your review)…"
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={2}
              />
              {reviewSubmitError && <div className="sde-github-auth-error">{reviewSubmitError}</div>}
              <div className="sde-github-review-toolbar-actions">
                <Button variant="secondary" size="sm" disabled={submittingReview} onClick={() => handleSubmitReview('COMMENT')}>
                  {submittingReview ? 'Submitting…' : 'Comment'}
                </Button>
                <Button variant="primary" size="sm" disabled={submittingReview} onClick={() => handleSubmitReview('APPROVE')}>
                  <Check size={13} /> Approve
                </Button>
                <Button variant="danger" size="sm" disabled={submittingReview} onClick={() => handleSubmitReview('REQUEST_CHANGES')}>
                  <XIcon size={13} /> Request Changes
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="sde-commit-details-section-label">Comments{comments.length ? ` (${comments.length})` : ''}</div>
        <div className="sde-github-comments">
          {comments.length === 0 ? (
            <div className="sde-github-empty">No comments yet.</div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="sde-github-comment">
                <div className="sde-github-comment-header">
                  <span className="sde-github-comment-author">{c.author}</span>
                  <span className="sde-github-comment-date">{relativeTime(c.createdAt)}</span>
                </div>
                <div className="sde-github-comment-body">{c.body}</div>
              </div>
            ))
          )}
        </div>

        <div className="sde-github-comment-form">
          <textarea
            className="sde-github-comment-input"
            placeholder="Leave a comment…"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            rows={3}
          />
          {commentError && <div className="sde-github-auth-error">{commentError}</div>}
          <Button
            variant="primary"
            size="sm"
            disabled={!commentBody.trim() || postingComment}
            onClick={handlePostComment}
          >
            {postingComment ? 'Posting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
};
