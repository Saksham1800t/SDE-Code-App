import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { getPanelTabRegistry } from '../../../panel/panelTabRegistry';
import { usePanelTabsStore } from '../../../store/panelTabs';
import { usePanelLayoutStore, type PanelPosition } from '../../../store/panelLayout';
import { useTerminalStore } from '../../../store/terminal';

interface PanelOverflowMenuProps {
  /** The "..." button's own rect, used to position the portalled menu relative to it. */
  anchorRect: DOMRect;
  onClose: () => void;
}

const POSITIONS: Array<{ id: PanelPosition; label: string }> = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'top', label: 'Top' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

// Flat list with section headers, not true flyout submenus — no flyout primitive exists in this codebase yet.
export const PanelOverflowMenu: React.FC<PanelOverflowMenuProps> = ({ anchorRect, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const registry = getPanelTabRegistry();
  const { hiddenIds, toggleTabHidden, showLabels, showIcons, setShowLabels, setShowIcons } = usePanelTabsStore();
  const { panelPosition } = usePanelLayoutStore();
  const { toggleTerminalPanel } = useTerminalStore();

  // Rendered "below the button" first, then flipped to "above the button" after mount if there
  // isn't enough room below — the same problem this menu previously had when the whole panel
  // (and this dropdown along with it) got clipped by a short bottom panel's overflow boundary.
  // Portalling to document.body fixes the clipping; the flip logic below keeps it fully visible.
  const [flipUp, setFlipUp] = useState(false);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) setFlipUp(true);
  }, []);

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

  const style: React.CSSProperties = {
    position: 'fixed',
    right: window.innerWidth - anchorRect.right,
    ...(flipUp
      ? { bottom: window.innerHeight - anchorRect.top + 4 }
      : { top: anchorRect.bottom + 4 }),
  };

  return createPortal(
    <div ref={menuRef} className="sde-tabbar-context-menu sde-panel-overflow-menu" style={style}>
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
    </div>,
    document.body,
  );
};
