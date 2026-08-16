import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useNotificationsStore } from '../../store/notifications';
import { NotificationLevel } from '../../types/notifications';
import './ToastContainer.css';

const LEVEL_ICON: Record<NotificationLevel, React.ReactNode> = {
  info: <Info size={16} />,
  success: <CheckCircle2 size={16} />,
  warning: <AlertTriangle size={16} />,
  error: <XCircle size={16} />,
};

export const ToastContainer: React.FC = () => {
  const { entries, dismiss } = useNotificationsStore();
  // Only the most recent still-active (non-dismissed) toasts stack visibly — the
  // full list, including auto-dismissed ones, lives in the status bar's history panel.
  const active = entries.filter((e) => !e.dismissed).slice(0, 5);

  if (active.length === 0) return null;

  return (
    <div className="sde-toast-container">
      {active.map((entry) => (
        <div key={entry.id} className={`sde-toast sde-toast--${entry.level}`}>
          <span className="sde-toast-icon">{LEVEL_ICON[entry.level]}</span>
          <div className="sde-toast-body">
            {entry.title && <div className="sde-toast-title">{entry.title}</div>}
            <div className="sde-toast-message">{entry.message}</div>
          </div>
          <button className="sde-toast-close" onClick={() => dismiss(entry.id)} title="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};
