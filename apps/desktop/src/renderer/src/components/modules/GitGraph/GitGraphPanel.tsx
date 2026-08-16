import React, { useEffect, useMemo, useState } from 'react';
import './GitGraph.css';
import { useGitStore } from '../../../store/git';
import { useWorkspaceStore } from '../../../store/workspace';
import { computeGraphLayout } from '../../../utils/gitGraphLayout';
import { parseRefs } from '../../../utils/gitRefs';
import { relativeTime } from '../../../utils/relativeTime';
import { Button } from '../../common/Button';

const LANE_WIDTH = 16;
const ROW_HEIGHT = 26;
const DOT_RADIUS = 3.5;
const LANE_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa', '#f87171', '#fb923c', '#22d3ee', '#e879f9'];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export const GitGraphPanel: React.FC = () => {
  const { gitGraphCommits, gitGraphHasMore, gitLoadGitGraph } = useGitStore();
  const openCommitDetailsTab = useWorkspaceStore((s) => s.openCommitDetailsTab);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    gitLoadGitGraph(true);
  }, []);

  const { rows, laneCount } = useMemo(() => computeGraphLayout(gitGraphCommits ?? []), [gitGraphCommits]);
  const graphWidth = Math.max(laneCount, 1) * LANE_WIDTH;

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await gitLoadGitGraph(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="sde-git-graph-panel">
      <div className="sde-git-graph-title">Git Graph</div>

      {gitGraphCommits === null ? (
        <div className="sde-git-graph-loading">Loading commit graph...</div>
      ) : rows.length === 0 ? (
        <div className="sde-git-graph-empty">No commits yet.</div>
      ) : (
        <>
          <div className="sde-git-graph-rows">
            {rows.map((row) => {
              const refs = parseRefs(row.commit.refs);
              const isTip = refs.length > 0;
              return (
                <div
                  key={row.commit.hash}
                  className="sde-git-graph-row"
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => openCommitDetailsTab(row.commit)}
                  title={`${row.commit.shortHash} · ${row.commit.author} · ${relativeTime(row.commit.date)}`}
                >
                  <svg width={graphWidth} height={ROW_HEIGHT} className="sde-git-graph-svg">
                    {row.segments.map((seg, i) => {
                      const x1 = seg.fromLane * LANE_WIDTH + LANE_WIDTH / 2;
                      const x2 = seg.toLane * LANE_WIDTH + LANE_WIDTH / 2;
                      let y1 = 0;
                      let y2 = ROW_HEIGHT;
                      if (seg.fromLane !== seg.toLane) {
                        if (seg.toLane === row.lane) y2 = ROW_HEIGHT / 2;
                        else if (seg.fromLane === row.lane) y1 = ROW_HEIGHT / 2;
                      }
                      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={laneColor(seg.fromLane)} strokeWidth={2} />;
                    })}
                    <circle
                      cx={row.lane * LANE_WIDTH + LANE_WIDTH / 2}
                      cy={ROW_HEIGHT / 2}
                      r={DOT_RADIUS}
                      fill={laneColor(row.lane)}
                    />
                  </svg>
                  <div className="sde-git-graph-info">
                    <span className={`sde-git-graph-message${isTip ? ' sde-git-graph-message--tip' : ''}`}>
                      {row.commit.message}
                    </span>
                    {refs.map((r, i) => (
                      <span key={i} className="sde-git-graph-ref-badge" style={{
                        background: `${r.color}18`, color: r.color, border: `1px solid ${r.color}40`,
                      }}>{r.label}</span>
                    ))}
                  </div>
                  <span className="sde-git-graph-author">{row.commit.author}</span>
                </div>
              );
            })}
          </div>

          {gitGraphHasMore && (
            <div className="sde-git-graph-load-more">
              <Button onClick={handleLoadMore} disabled={loadingMore} size="sm">
                {loadingMore ? 'Loading…' : 'Load More'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
