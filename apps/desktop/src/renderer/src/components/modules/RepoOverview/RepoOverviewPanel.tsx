import React, { useEffect } from 'react';
import './RepoOverview.css';
import { useGitStore } from '../../../store/git';
import { GitHeatmap } from '../GitPanel/GitHeatmap';
import { relativeTime } from '../../../utils/relativeTime';
import { Tag } from 'lucide-react';

const StatTile: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="sde-repo-overview-tile">
    <div className="sde-repo-overview-tile-value">{value}</div>
    <div className="sde-repo-overview-tile-label">{label}</div>
  </div>
);

export const RepoOverviewPanel: React.FC = () => {
  const { repoStats, gitLoadRepoStats, gitGetHeatmap } = useGitStore();

  useEffect(() => {
    gitLoadRepoStats();
  }, []);

  if (!repoStats) {
    return (
      <div className="sde-repo-overview-panel">
        <div className="sde-repo-overview-container">
          <div className="sde-repo-overview-title">Repository Overview</div>
          <div className="sde-repo-overview-loading">Loading repository stats...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sde-repo-overview-panel">
      <div className="sde-repo-overview-container">
        <div className="sde-repo-overview-title">Repository Overview</div>

        <div className="sde-repo-overview-grid">
          <StatTile label="Commits" value={repoStats.commitCount} />
          <StatTile label="Branches" value={repoStats.branchCount} />
          <StatTile label="Contributors" value={repoStats.contributorCount} />
          <StatTile label="Tags" value={repoStats.tagCount} />
        </div>

        <div className="sde-repo-overview-section-label">Latest Commit</div>
        {repoStats.latestCommit ? (
          <div className="sde-repo-overview-commit-card">
            <code className="sde-repo-overview-commit-hash">{repoStats.latestCommit.shortHash}</code>
            <div className="sde-repo-overview-commit-message">{repoStats.latestCommit.message}</div>
            <div className="sde-repo-overview-commit-meta">
              {repoStats.latestCommit.author} · {relativeTime(repoStats.latestCommit.date)}
              {repoStats.latestTag && <span className="sde-repo-overview-commit-tag"><Tag size={11} /> {repoStats.latestTag}</span>}
            </div>
          </div>
        ) : (
          <div className="sde-repo-overview-empty">No commits yet.</div>
        )}

        <div className="sde-repo-overview-section-label">Activity</div>
        {/* Not gated behind the 'git-heatmap' flag — that only scopes the cramped sidebar embed in GitPanel.tsx, not this full-tab view. */}
        <GitHeatmap getHeatmap={gitGetHeatmap} />
      </div>
    </div>
  );
};
