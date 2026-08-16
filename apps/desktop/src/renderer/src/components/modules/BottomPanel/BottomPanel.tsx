import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './BottomPanel.css';
import { useTerminalStore, type BottomPanelTab } from '../../../store/terminal';
import { usePanelTabsStore } from '../../../store/panelTabs';
import { usePanelLayoutStore } from '../../../store/panelLayout';
import { getPanelTabRegistry, type RegisteredPanelTab } from '../../../panel/panelTabRegistry';
import { PanelOverflowMenu } from './PanelOverflowMenu';
import { X, ChevronUp, ChevronDown, MoreHorizontal } from 'lucide-react';

interface TabContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string | null;
}

interface PanelTabButtonProps {
  tab: RegisteredPanelTab;
  isActive: boolean;
  showLabel: boolean;
  showIcon: boolean;
  badgeHidden: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

// Separate component (not inlined in .map()) because tab.useBadge() is a hook and can't be called conditionally in a loop.
const PanelTabButton: React.FC<PanelTabButtonProps> = ({
  tab,
  isActive,
  showLabel,
  showIcon,
  badgeHidden,
  isDragging,
  isDragOver,
  onClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) => {
  const badgeCount = tab.useBadge();
  const badgeVariant = badgeCount ? tab.useBadgeVariant() : undefined;
  const Icon = tab.icon;

  return (
    <button
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`sde-bottom-panel-tab${isActive ? ' active' : ''}${isDragging ? ' sde-bottom-panel-tab--dragging' : ''}${isDragOver ? ' sde-bottom-panel-tab--drag-over' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {showIcon && <Icon size={13} />}
      {showLabel && <span>{tab.label}</span>}
      {!badgeHidden && !!badgeCount && (
        <span className={`sde-bottom-panel-badge sde-bottom-panel-badge--${badgeVariant}`}>{badgeCount}</span>
      )}
    </button>
  );
};

// Registered tabs stay mounted and are only hidden via CSS so switching tabs never drops a running terminal session or restarts the ports poll.
export const BottomPanel: React.FC = () => {
  const { activeBottomTab, setActiveBottomTab, toggleTerminalPanel } = useTerminalStore();
  const {
    order,
    hiddenBadgeIds,
    showLabels,
    showIcons,
    getVisibleOrderedTabIds,
    toggleTabHidden,
    toggleTabBadge,
    reorderTabs,
  } = usePanelTabsStore();
  const { isPanelMaximized, togglePanelMaximized } = usePanelLayoutStore();

  const registry = getPanelTabRegistry();
  const visibleIds = getVisibleOrderedTabIds();
  const activeTab = registry.find((t) => t.id === activeBottomTab) ?? registry.find((t) => t.id === visibleIds[0]);

  const switchToTab = (tabId: string) => {
    setActiveBottomTab(tabId as BottomPanelTab);
    if (tabId === 'terminal') {
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
  };
  const [contextMenu, setContextMenu] = useState<TabContextMenuState>({ visible: false, x: 0, y: 0, tabId: null });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const openContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 200;
    const menuHeight = 110;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    setContextMenu({ visible: true, x, y, tabId });
  };
  const closeContextMenu = () => setContextMenu((prev) => ({ ...prev, visible: false }));

  const contextTab = registry.find((t) => t.id === contextMenu.tabId);
  const contextTabHasBadge = !!contextTab && contextTab.useBadge !== undefined;
  const contextTabBadgeHidden = !!contextTab && hiddenBadgeIds.includes(contextTab.id);
  const isLastVisibleTab = visibleIds.length <= 1;

  // ── Drag-to-reorder ──────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const fullOrderedIds = (): string[] => {
    const registryIds = registry.slice().sort((a, b) => a.order - b.order).map((t) => t.id);
    const known = order.filter((id) => registryIds.includes(id));
    const unknown = registryIds.filter((id) => !known.includes(id));
    return [...known, ...unknown];
  };

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const original = fullOrderedIds();
    const dragIdx = original.indexOf(draggingId);
    const targetIdx = original.indexOf(targetId);
    if (dragIdx === -1 || targetIdx === -1) return;

    const base = original.filter((id) => id !== draggingId);
    let insertIdx = base.indexOf(targetId);
    if (dragIdx < targetIdx) insertIdx += 1;
    base.splice(insertIdx, 0, draggingId);
    reorderTabs(base);
  };

  // ── Overflow menu ────────────────────────────────────────────────────
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="sde-bottom-panel">
      <div className="sde-bottom-panel-tabs">
        <div className="sde-bottom-panel-tabs-left">
          {visibleIds.map((id) => {
            const tab = registry.find((t) => t.id === id);
            if (!tab) return null;
            return (
              <PanelTabButton
                key={tab.id}
                tab={tab}
                isActive={activeBottomTab === tab.id}
                showLabel={showLabels}
                showIcon={showIcons}
                badgeHidden={hiddenBadgeIds.includes(tab.id)}
                isDragging={draggingId === tab.id}
                isDragOver={dragOverId === tab.id}
                onClick={() => switchToTab(tab.id)}
                onContextMenu={(e) => openContextMenu(e, tab.id)}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', tab.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(tab.id); }}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(tab.id); }}
                onDragLeave={() => setDragOverId((prev) => (prev === tab.id ? null : prev))}
                onDrop={(e) => { e.preventDefault(); handleDrop(tab.id); setDraggingId(null); setDragOverId(null); }}
                onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
              />
            );
          })}
        </div>

        <div className="sde-bottom-panel-actions">
          <div className="sde-bottom-panel-actions-view">
            {activeTab?.renderActions && <activeTab.renderActions isActive />}
          </div>
          <div className="sde-bottom-panel-actions-global">
            <button
              className="sde-icon-btn"
              title={isPanelMaximized ? 'Restore Panel Size' : 'Maximize Panel Size'}
              onClick={() => togglePanelMaximized()}
            >
              {isPanelMaximized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <div className="sde-bottom-panel-overflow-anchor">
              <button
                ref={overflowBtnRef}
                className="sde-icon-btn"
                title="More Actions..."
                onClick={() => setOverflowOpen((v) => !v)}
              >
                <MoreHorizontal size={14} />
              </button>
              {overflowOpen && overflowBtnRef.current && (
                <PanelOverflowMenu anchorRect={overflowBtnRef.current.getBoundingClientRect()} onClose={() => setOverflowOpen(false)} />
              )}
            </div>
            <button className="sde-icon-btn" title="Hide Panel" onClick={() => toggleTerminalPanel(false)}>
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="sde-bottom-panel-body">
        {registry.map((tab) => (
          <div
            key={tab.id}
            className={`sde-bottom-panel-pane${activeBottomTab === tab.id && visibleIds.includes(tab.id) ? '' : ' sde-bottom-panel-pane--hidden'}`}
          >
            <tab.render />
          </div>
        ))}
      </div>

      {contextMenu.visible && contextTab && createPortal(
        <div ref={menuRef} className="sde-tabbar-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button
            className="sde-menu-item"
            disabled={isLastVisibleTab}
            onClick={() => { toggleTabHidden(contextTab.id); closeContextMenu(); }}
          >
            Hide '{contextTab.label}'
          </button>
          {contextTabHasBadge && (
            <button
              className="sde-menu-item"
              onClick={() => { toggleTabBadge(contextTab.id); closeContextMenu(); }}
            >
              {contextTabBadgeHidden ? 'Show Badge' : 'Hide Badge'}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};
