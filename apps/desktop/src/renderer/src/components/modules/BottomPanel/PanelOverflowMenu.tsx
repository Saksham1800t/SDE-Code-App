import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { getPanelTabRegistry } from '../../../panel/panelTabRegistry';
import { usePanelTabsStore } from '../../../store/panelTabs';
import { usePanelLayoutStore, type PanelPosition } from '../../../store/panelLayout';
import { useTerminalStore } from '../../../store/terminal';

interface PanelOverflowMenuProps {
  onClose: () => void;
}

const POSITIONS: Array<{ id: PanelPosition; label: string }> = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'top', label: 'Top' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

// Flat list with section headers, not true flyout submenus — no flyout primitive exists in this codebase yet.
export const PanelOverflowMenu: React.FC<PanelOverflowMenuProps> = ({ onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const registry = getPanelTabRegistry();
  const { hiddenIds, toggleTabHidden, showLabels, showIcons, setShowLabels, setShowIcons } = usePanelTabsStore();
  const { panelPosition } = usePanelLayoutStore();
  const { toggleTerminalPanel } = useTerminalStore();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="sde-tabbar-context-menu sde-panel-overflow-menu">
      <div className="sde-context-menu-header">Panel Tabs</div>
      {registry.map((tab) => (
        <button
          key={tab.id}
          className="sde-menu-item"
          onClick={() => toggleTabHidden(tab.id)}
        >
          <span className="sde-menu-item-check">{!hiddenIds.includes(tab.id) && <Check size={12} />}</span>
          {tab.label}
        </button>
      ))}

      <div className="sde-separator" />

      <div className="sde-context-menu-header">Position</div>
      {POSITIONS.map((pos) => (
        <button
          key={pos.id}
          className="sde-menu-item"
          disabled={pos.id !== 'bottom'}
          title={pos.id !== 'bottom' ? 'Coming soon' : undefined}
          onClick={() => { /* only bottom is functional this pass */ }}
        >
          <span className="sde-menu-item-check">{panelPosition === pos.id && <Check size={12} />}</span>
          {pos.label}
        </button>
      ))}

      <div className="sde-separator" />

      <button className="sde-menu-item" onClick={() => setShowLabels(!showLabels)}>
        <span className="sde-menu-item-check">{showLabels && <Check size={12} />}</span>
        Show Labels
      </button>
      <button className="sde-menu-item" onClick={() => setShowIcons(!showIcons)}>
        <span className="sde-menu-item-check">{showIcons && <Check size={12} />}</span>
        Show Icons
      </button>

      <div className="sde-separator" />

      <button className="sde-menu-item" onClick={() => { toggleTerminalPanel(false); onClose(); }}>
        Hide Panel
      </button>
    </div>
  );
};
