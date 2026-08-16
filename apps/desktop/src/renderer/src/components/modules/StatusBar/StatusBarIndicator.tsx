import React from 'react';
import './StatusBar.css';
import { renderStatusBarIcon } from '../../../utils/statusBarIcons';

export interface StatusBarItem {
  id: string;
  text: string;
  alignment: 'left' | 'right';
  priority: number;
  visible: boolean;
  icon?: string;
  tooltip?: string;
  commandId?: string;
}

interface StatusBarIndicatorProps {
  item: StatusBarItem;
  executeCommand: (id: string) => void;
}

export const StatusBarIndicator: React.FC<StatusBarIndicatorProps> = ({ item, executeCommand }) => {
  const isClickable = !!item.commandId;

  return (
    <div
      data-tooltip={item.tooltip || undefined}
      onClick={() => { if (item.commandId) executeCommand(item.commandId); }}
      className={`sde-status-indicator${isClickable ? ' sde-status-indicator--clickable' : ''}`}
    >
      {item.icon && <span className="sde-status-indicator-icon">{renderStatusBarIcon(item.icon)}</span>}
      <span className="sde-status-indicator-text">{item.text}</span>
    </div>
  );
};
