import React from 'react';
import './StatusBar.css';
import { StatusBarItem } from './StatusBarIndicator';

interface IndicatorVisibilityMenuProps {
  items: StatusBarItem[];
  toggleItemVisibility: (id: string) => void;
  contextMenuPos: { x: number; y: number } | null;
  contextMenuRef: React.RefObject<HTMLDivElement>;
}

export const IndicatorVisibilityMenu: React.FC<IndicatorVisibilityMenuProps> = ({
  items,
  toggleItemVisibility,
  contextMenuPos,
  contextMenuRef,
}) => {
  if (!contextMenuPos) return null;

  const top = contextMenuPos.y - 200 > 0 ? contextMenuPos.y - 200 : 10;

  return (
    <div
      ref={contextMenuRef}
      className="sde-indicator-menu"
      style={{ top, left: contextMenuPos.x }}
    >
      <div className="sde-indicator-menu-header">Toggle Status Indicators</div>
      {items.map((item) => (
        <button
          key={item.id}
          className="sde-indicator-menu-item"
          onClick={() => toggleItemVisibility(item.id)}
        >
          <input
            type="checkbox"
            checked={item.visible}
            readOnly
            className="sde-indicator-checkbox"
          />
          <span>{item.text.trim() || item.id}</span>
        </button>
      ))}
    </div>
  );
};
