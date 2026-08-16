import React, { useEffect, useState } from 'react';
import './GitHub.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useGitHubStore } from '../../../store/github';
import { relativeTime } from '../../../utils/relativeTime';
import { Button } from '../../common/Button';
import { GitPullRequest, CircleDot, Copy, ExternalLink, X } from 'lucide-react';

const GithubMarkIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.535-1.53.115-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.65 1.65.235 2.88.115 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

type ListTab = 'prs' | 'issues';

export const GitHubPanel: React.FC = () => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openGitHubItemTab = useWorkspaceStore((s) => s.openGitHubItemTab);
  const {
    user, isAuthenticating, deviceCode,
    repo, pullRequests, issues, loadingList,
    initialize, startAuth, cancelAuth, signOut, detectRepo, loadPullRequests, loadIssues,
  } = useGitHubStore();
  const [listTab, setListTab] = useState<ListTab>('prs');

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (workspacePath) detectRepo(workspacePath);
  }, [workspacePath, detectRepo]);

  useEffect(() => {
    if (!user || !repo) return;
    if (listTab === 'prs') loadPullRequests();
    else loadIssues();
  }, [user, repo, listTab, loadPullRequests, loadIssues]);

  if (!user) {
    return (
      <div className="sde-github-panel">
        <div className="sde-github-auth-gate">
          <GithubMarkIcon size={32} className="sde-github-auth-icon" />
          {isAuthenticating && deviceCode ? (
            <>
              <div className="sde-github-auth-copy">Enter this code on GitHub to authorize SDE Code:</div>
              <div className="sde-github-device-code">
                {deviceCode.userCode}
                <button
                  className="sde-github-copy-btn"
                  title="Copy code"
                  onClick={() => navigator.clipboard.writeText(deviceCode.userCode)}
                >
                  <Copy size={13} />
                </button>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => window.api?.openExternal?.(deviceCode.verificationUri)}
              >
                <ExternalLink size={13} /> Open GitHub to Authorize
              </Button>
              <button className="sde-github-cancel-btn" onClick={cancelAuth}>
                <X size={12} /> Cancel
              </button>
            </>
          ) : (
            <>
              <div className="sde-github-auth-copy">
                Sign in to view and comment on pull requests and issues for this repository.
              </div>
              <Button variant="primary" size="sm" onClick={startAuth}>
                <GithubMarkIcon size={13} /> Sign in to GitHub
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="sde-github-panel">
        <div className="sde-github-empty">
          No GitHub remote detected for this workspace. Open a folder with a github.com "origin" remote to see its pull requests and issues.
        </div>
      </div>
    );
  }

  const items = listTab === 'prs' ? pullRequests : issues;

  return (
    <div className="sde-github-panel">
      <div className="sde-github-repo-header">
        <span className="sde-github-repo-name">{repo.owner}/{repo.repo}</span>
        <button className="sde-github-signout-btn" onClick={signOut} title={`Signed in as ${user.login} — Sign out`}>
          Sign out
        </button>
      </div>

      <div className="sde-github-tabs">
        <button
          className={`sde-github-tab${listTab === 'prs' ? ' active' : ''}`}
          onClick={() => setListTab('prs')}
        >
          <GitPullRequest size={13} /> Pull Requests
        </button>
        <button
          className={`sde-github-tab${listTab === 'issues' ? ' active' : ''}`}
          onClick={() => setListTab('issues')}
        >
          <CircleDot size={13} /> Issues
        </button>
      </div>

      <div className="sde-github-list">
        {loadingList ? (
          <div className="sde-github-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="sde-github-empty">No open {listTab === 'prs' ? 'pull requests' : 'issues'}.</div>
        ) : (
          items.map((item) => (
            <div
              key={item.number}
              className="sde-github-list-row"
              onClick={() => openGitHubItemTab(item.number, listTab === 'prs', item.title)}
            >
              {listTab === 'prs' ? (
                <GitPullRequest size={14} className="sde-github-list-icon" />
              ) : (
                <CircleDot size={14} className="sde-github-list-icon" />
              )}
              <div className="sde-github-list-info">
                <span className="sde-github-list-title">{item.title}</span>
                <span className="sde-github-list-meta">
                  #{item.number} opened by {item.author} · {relativeTime(item.updatedAt)}
                  {listTab === 'prs' && (item as any).draft ? ' · Draft' : ''}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
