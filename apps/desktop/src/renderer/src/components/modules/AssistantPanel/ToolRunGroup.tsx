import React, { useEffect, useState } from 'react';
import { ChevronRight, Settings } from 'lucide-react';
import type { Message } from './MessageItem';

interface ToolRunGroupProps {
  items: Message[];
  startedAt: number;
  endedAt: number | null;
  isLive: boolean;
}

function formatDuration(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

export const ToolRunGroup: React.FC<ToolRunGroupProps> = ({ items, startedAt, endedAt, isLive }) => {
  const [expanded, setExpanded] = useState(isLive);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isLive || endedAt !== null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isLive, endedAt]);

  const duration = (endedAt ?? now) - startedAt;

  return (
    <div className="sde-tool-run">
      <button className="sde-tool-run-header" onClick={() => setExpanded((e) => !e)}>
        <ChevronRight size={12} className={`sde-tool-run-chevron${expanded ? ' expanded' : ''}`} />
        Worked for {formatDuration(duration)}
      </button>
      {expanded && (
        <div className="sde-tool-run-items">
          {items.map((msg, i) => (
            <div key={i} className="sde-msg-tool-progress">
              <span className="sde-msg-tool-progress-icon"><Settings size={12} /></span>
              {msg.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
