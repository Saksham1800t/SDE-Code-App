import React, { useEffect, useRef } from 'react';
import './OutputPanel.css';
import { useOutputStore } from '../../../store/output';
import { Trash2 } from 'lucide-react';

export const OutputPanel: React.FC = () => {
  const { channels, activeChannelId, setActiveChannel, clearChannel } = useOutputStore();
  const listRef = useRef<HTMLDivElement>(null);
  const channelList = Object.values(channels);
  const active = channels[activeChannelId];

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.lines.length]);

  return (
    <div className="sde-output-panel">
      <div className="sde-output-toolbar">
        <select
          className="sde-output-channel-select"
          value={activeChannelId}
          onChange={(e) => setActiveChannel(e.target.value)}
        >
          {channelList.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <button
          className="sde-icon-btn"
          title="Clear Output"
          onClick={() => active && clearChannel(active.id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div ref={listRef} className="sde-output-lines">
        {!active || active.lines.length === 0 ? (
          <div className="sde-output-empty">No output yet.</div>
        ) : (
          active.lines.map((line, i) => (
            <div key={i} className="sde-output-line">{line}</div>
          ))
        )}
      </div>
    </div>
  );
};
