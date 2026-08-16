import React, { useEffect, useMemo, useState } from 'react';
import './EmbeddedGitGraph.css';
import { useGitStore } from '../../../store/git';
import type { GitGraphCommit, GitCommitFile } from '../../../store/git';
import { computeGraphLayout } from '../../../utils/gitGraphLayout';
import { parseRefs } from '../../../utils/gitRefs';
import { relativeTime } from '../../../utils/relativeTime';
import { CommitFileRow } from './CommitFileRow';

const LANE_WIDTH = 12;
const ROW_HEIGHT = 24;
const DOT_RADIUS = 3;
const PAGE_SIZE = 25;
const LANE_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa', '#f87171', '#fb923c', '#22d3ee', '#e879f9'];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

interface EmbeddedGitGraphProps {
  repoPath: string;
  repoName: string;
  /** Shown when the workspace has more than one repo; omitted otherwise so this reads like the flat "COMMITS (n)" list it replaces. */
  showHeader: boolean;
}

export const EmbeddedGitGraph: React.FC<EmbeddedGitGraphProps> = ({ repoPath, repoName, showHeader }) => {
  const { gitFetchCommitGraph, gitFetchCommitFiles, gitOpenCommitFileDiff } = useGitStore();
  const [commits, setCommits] = useState<GitGraphCommit[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<GitCommitFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setExpandedHash(null);
    setExpandedFiles(null);
    gitFetchCommitGraph(repoPath, PAGE_SIZE, 0)
      .then((page) => {
        if (cancelled) return;
        setCommits(page);
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch((err) => {
        console.error('Failed to fetch commit graph:', err);
        if (!cancelled) setCommits([]);
      });
    return () => { cancelled = true; };
  }, [repoPath]);

  const { rows, laneCount } = useMemo(() => computeGraphLayout(commits ?? []), [commits]);
  const graphWidth = Math.max(laneCount, 1) * LANE_WIDTH;

  const handleLoadMore = async () => {
    if (!commits) return;
    setLoadingMore(true);
    try {
      const page = await gitFetchCommitGraph(repoPath, PAGE_SIZE, commits.length);
      setCommits([...commits, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleToggleExpand = async (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
      setExpandedFiles(null);
      return;
    }
    setExpandedHash(hash);
    setExpandedFiles(null);
    setLoadingFiles(true);
    try {
      setExpandedFiles(await gitFetchCommitFiles(repoPath, hash));
    } finally {
      setLoadingFiles(false);
    }
  };

  // Matches GitLogPanel's own self-hiding behavior for a repo with no
  // commits yet — nothing to show, so show nothing.
  if (commits !== null && commits.length === 0) return null;

  return (
    <div className="sde-embedded-graph">
      <div onClick={() => setCollapsed((c) => !c)} className="sde-git-stash-toggle-row">
        <span className="sde-git-section-hdr-label">
          {showHeader ? repoName.toUpperCase() : 'COMMITS'}{commits ? ` (${commits.length}${hasMore ? '+' : ''})` : ''}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {!collapsed && (
        commits === null ? (
          <div className="sde-embedded-graph-loading">Loading commits...</div>
        ) : (
          <div>
            {rows.map((row) => {
              const refs = parseRefs(row.commit.refs);
              const isTip = refs.length > 0;
              const isExpanded = expandedHash === row.commit.hash;
              return (
                <React.Fragment key={row.commit.hash}>
                  <div
                    className={`sde-embedded-graph-row${isExpanded ? ' active' : ''}`}
                    onClick={() => handleToggleExpand(row.commit.hash)}
                    title={`${row.commit.shortHash} · ${row.commit.author} · ${relativeTime(row.commit.date)}`}
                  >
                    <svg width={graphWidth} height={ROW_HEIGHT} className="sde-embedded-graph-svg">
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
                    <span className={`sde-embedded-graph-message${isTip ? ' sde-embedded-graph-message--tip' : ''}`}>
                      {row.commit.message}
                    </span>
                    {refs.map((r, i) => (
                      <span key={i} className="sde-embedded-graph-ref-badge" style={{
                        background: `${r.color}18`, color: r.color, border: `1px solid ${r.color}40`,
                      }}>{r.label}</span>
                    ))}
                    <span className="sde-embedded-graph-author">{row.commit.author}</span>
                  </div>

                  {isExpanded && (() => {
                    // Lanes still running past this row must stay drawn through the file list too, or the graph reads as broken while expanded.
                    const continuingLanes = Array.from(new Set(
                      row.segments
                        .filter((seg) => !(seg.fromLane !== seg.toLane && seg.toLane === row.lane))
                        .map((seg) => seg.toLane)
                    ));
                    return (
                      <div className="sde-embedded-graph-files">
                        <div className="sde-embedded-graph-files-lanes" style={{ width: graphWidth }}>
                          {continuingLanes.map((lane) => (
                            <div
                              key={lane}
                              className="sde-embedded-graph-files-lane-line"
                              style={{ left: lane * LANE_WIDTH + LANE_WIDTH / 2 - 1, background: laneColor(lane) }}
                            />
                          ))}
                        </div>
                        <div className="sde-embedded-graph-files-list">
                          {loadingFiles ? (
                            <div className="sde-embedded-graph-loading">Loading changed files...</div>
                          ) : expandedFiles && expandedFiles.length > 0 ? (
                            expandedFiles.map((file) => {
                              const fileName = file.path.split('/').pop() || file.path;
                              return (
                                <CommitFileRow
                                  key={file.path}
                                  file={file}
                                  onClick={() => gitOpenCommitFileDiff(row.commit.hash, file.path, fileName, repoPath)}
                                />
                              );
                            })
                          ) : (
                            <div className="sde-embedded-graph-loading">No changed files.</div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </React.Fragment>
              );
            })}

            {hasMore && (
              <button className="sde-embedded-graph-load-more" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load More'}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
};
