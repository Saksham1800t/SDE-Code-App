import React, { useEffect, useRef, useState } from 'react';
import './TerminalArea.css';
import { SquareTerminal, Trash2 } from 'lucide-react';

interface TerminalSession {
  id: string;
  name: string;
}

interface TerminalSessionsSidebarProps {
  terminals: TerminalSession[];
  activeTerminalId: string | null;
  setActiveTerminal: (id: string) => void;
  closeTerminal: (id: string) => void;
  renameTerminal: (id: string, name: string) => void;
}

const RenameInput: React.FC<{ session: TerminalSession; onDone: () => void; renameTerminal: (id: string, name: string) => void }> = ({
  session,
  onDone,
  renameTerminal,
}) => {
  const [value, setValue] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isCommittedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== session.name) renameTerminal(session.id, trimmed);
    onDone();
  };

  const cancel = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    onDone();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') cancel();
      }}
      className="sde-inline-input sde-terminal-session-rename-input"
    />
  );
};

/** Narrow vertical session list beside the terminal content (not horizontal tabs); only rendered when there's more than one session. */
export const TerminalSessionsSidebar: React.FC<TerminalSessionsSidebarProps> = ({
  terminals,
  activeTerminalId,
  setActiveTerminal,
  closeTerminal,
  renameTerminal,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Manual timestamp-based double-click detection, since the resize/focus side effect of switching terminals can break native dblclick.
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  const handleRowClick = (id: string) => {
    const last = lastClickRef.current;
    const now = Date.now();
    if (last && last.id === id && now - last.time < 400) {
      lastClickRef.current = null;
      setRenamingId(id);
      return;
    }
    lastClickRef.current = { id, time: now };
    setActiveTerminal(id);
  };

  return (
    <div className="sde-terminal-sessions-sidebar">
      {terminals.map((t) => {
        const isActive = t.id === activeTerminalId;
        const isRenaming = renamingId === t.id;
        return (
          <div
            key={t.id}
            onClick={() => handleRowClick(t.id)}
            className={`sde-terminal-session-item${isActive ? ' active' : ''}`}
          >
            <SquareTerminal size={13} className="sde-terminal-session-icon" />
            {isRenaming ? (
              <RenameInput session={t} onDone={() => setRenamingId(null)} renameTerminal={renameTerminal} />
            ) : (
              <span className="sde-terminal-session-name">{t.name}</span>
            )}
            <button
              className="sde-tab-close-btn"
              onClick={(e) => { e.stopPropagation(); closeTerminal(t.id); }}
              aria-label={`Kill ${t.name}`}
              title="Kill Terminal"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
