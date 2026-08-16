import React, { useEffect, useRef, useState } from 'react';
import './GitPanel.css';
import { intensityColor } from '../../../utils/heatmapColors';
import { Flame } from 'lucide-react';

interface GitHeatmapProps {
  getHeatmap: (weeks?: number) => Promise<Record<string, number>>;
}

const WEEKS = 26; // ~6 months shown
const DAYS = 7;
const CELL = 10;
const GAP = 2;

function getDayLabel(i: number) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i];
}

function getMonthLabels(startDate: Date): { label: string; col: number }[] {
  const labels: { label: string; col: number }[] = [];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + w * 7);
    const m = d.getMonth();
    if (m !== lastMonth) { labels.push({ label: months[m], col: w }); lastMonth = m; }
  }
  return labels;
}

export const GitHeatmap: React.FC<GitHeatmapProps> = ({ getHeatmap }) => {
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHeatmap(WEEKS)
      .then(setHeatmap)
      .catch((err) => console.error('Failed to load git heatmap:', err));
  }, [getHeatmap]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - WEEKS * 7 + 1);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const totalCommits = Object.values(heatmap).reduce((s, c) => s + c, 0);
  const maxCount = Math.max(...Object.values(heatmap), 1);

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if ((heatmap[key] || 0) > 0) streak++; else break;
  }

  const monthLabels = getMonthLabels(startDate);

  const cells: { date: string; count: number; col: number; row: number }[] = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const dt = new Date(startDate);
      dt.setDate(startDate.getDate() + w * 7 + d);
      if (dt > today) continue;
      const key = dt.toISOString().split('T')[0];
      cells.push({ date: key, count: heatmap[key] || 0, col: w, row: d });
    }
  }

  const gridW = WEEKS * (CELL + GAP);
  const gridH = DAYS * (CELL + GAP);

  return (
    <div className="sde-git-heatmap">
      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        className="sde-git-stash-toggle-row"
      >
        <div className="sde-git-section-hdr-left">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="sde-git-section-hdr-label">
            ACTIVITY
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{totalCommits} commits</span>
          {streak > 1 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '10px', color: 'var(--color-warning)' }}>
              <Flame size={11} /> {streak}-day streak
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <div ref={containerRef} className="sde-git-heatmap-container">
          {/* Month labels */}
          <div className="sde-git-heatmap-months">
            {monthLabels.map((m, i) => (
              <span key={i} className="sde-git-heatmap-month-label" style={{ left: m.col * (CELL + GAP) }}>
                {m.label}
              </span>
            ))}
          </div>

          <div className="sde-git-heatmap-grid-row">
            {/* Day labels */}
            <div className="sde-git-heatmap-days" style={{ gap: `${GAP}px` }}>
              {Array.from({ length: DAYS }, (_, i) => (
                <div key={i} className="sde-git-heatmap-day-label" style={{ height: CELL, lineHeight: `${CELL}px` }}>
                  {i % 2 === 1 ? getDayLabel(i).slice(0, 1) : ''}
                </div>
              ))}
            </div>

            {/* Grid */}
            <svg width={gridW} height={gridH}>
              {cells.map(cell => (
                <rect
                  key={cell.date}
                  x={cell.col * (CELL + GAP)}
                  y={cell.row * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={intensityColor(cell.count, maxCount)}
                  style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                  onMouseEnter={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const containerRect = containerRef.current?.getBoundingClientRect();
                    setTooltip({
                      text: `${cell.count} commit${cell.count !== 1 ? 's' : ''} on ${cell.date}`,
                      x: rect.left - (containerRect?.left || 0) + CELL / 2,
                      y: rect.top - (containerRect?.top || 0) - 28
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </svg>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div className="sde-git-heatmap-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
              {tooltip.text}
            </div>
          )}

          {/* Legend */}
          <div className="sde-git-heatmap-legend">
            <span className="sde-git-heatmap-legend-label">Less</span>
            {[0, 0.2, 0.5, 0.8, 1].map((p, i) => (
              <div key={i} style={{ width: CELL, height: CELL, borderRadius: 2, background: intensityColor(p * maxCount, maxCount) }} />
            ))}
            <span className="sde-git-heatmap-legend-label">More</span>
          </div>
        </div>
      )}
    </div>
  );
};
