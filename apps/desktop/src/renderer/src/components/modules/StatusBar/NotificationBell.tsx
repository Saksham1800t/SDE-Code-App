import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, AlertTriangle, XCircle, Info, Trash2 } from 'lucide-react';
import { useNotificationsStore } from '../../../store/notifications';
import { NotificationLevel } from '../../../types/notifications';
import './NotificationBell.css';

const LEVEL_ICON: Record<NotificationLevel, React.ReactNode> = {
  info: <Info size={13} />,
  success: <CheckCircle2 size={13} />,
  warning: <AlertTriangle size={13} />,
  error: <XCircle size={13} />,
};

function formatRelativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestampMs).toLocaleTimeString();
}

export const NotificationBell: React.FC = () => {
  const { entries, markAllRead, clearAll } = useNotificationsStore();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = entries.filter((e) => !e.read).length;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = () => {
    setOpen((o) => {
      if (!o) markAllRead();
      return !o;
    });
  };

  return (
    <div className="sde-notification-bell-anchor" ref={panelRef}>
      <button className="sde-status-indicator sde-status-indicator--clickable sde-notification-bell-btn" onClick={handleToggle} title="Notifications">
        <Bell size={13} />
        {unreadCount > 0 && <span className="sde-notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="sde-notification-panel">
          <div className="sde-notification-panel-header">
            <span>Notifications</span>
            {entries.length > 0 && (
              <button className="sde-notification-clear-btn" onClick={clearAll} title="Clear all">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
          <div className="sde-notification-panel-list">
            {entries.length === 0 ? (
              <div className="sde-notification-empty">No notifications yet.</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className={`sde-notification-row sde-notification-row--${entry.level}`}>
                  <span className="sde-notification-row-icon">{LEVEL_ICON[entry.level]}</span>
                  <div className="sde-notification-row-body">
                    {entry.title && <div className="sde-notification-row-title">{entry.title}</div>}
                    <div className="sde-notification-row-message">{entry.message}</div>
                    <div className="sde-notification-row-time">{formatRelativeTime(entry.timestamp)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
