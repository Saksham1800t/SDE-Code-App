import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './TabBar.css';
import { Columns2, X } from 'lucide-react';
import { getFileIconUrl } from '../../../utils/fileIcons';
import { useWorkspaceStore } from '../../../store/workspace';
import { useThemeStore } from '../../../store/theme';

interface Tab {
  name: string;
  path: string;
  content: string;
  isDirty?: boolean;
  isSettings?: boolean;
  settingsType?: 'settings' | 'shortcuts';
  isDiff?: boolean;
  originalContent?: string;
}

interface TabBarProps {
  openTabs: Tab[];
  activeTabPath: string | null;
  setActiveTab: (path: string, groupId?: string) => void;
  closeFile: (path: string, options?: { skipUnsavedCheck?: boolean; groupId?: string }) => Promise<void>;
  groupId: string;
  isOnlyGroup: boolean;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabPath: string | null;
}

export const TabBar: React.FC<TabBarProps> = ({
  openTabs,
  activeTabPath,
  setActiveTab,
  closeFile,
  groupId,
  isOnlyGroup,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabPath: null,
  });
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const iconMap = useThemeStore((s) => (s.extensionThemes[s.currentTheme] ?? s.localThemes[s.currentTheme])?.iconMap);


  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('application/sde-tab', JSON.stringify({ path, groupId }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOverTab = (e: React.DragEvent, path: string) => {
    if (!e.dataTransfer.types.includes('application/sde-tab')) return;
    e.preventDefault();
    setDragOverPath(path);
  };
  const handleDropOnTab = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverPath(null);
    const raw = e.dataTransfer.getData('application/sde-tab');
    if (!raw) return;
    const { path, groupId: fromGroupId } = JSON.parse(raw) as { path: string; groupId: string };
    useWorkspaceStore.getState().moveTabToGroup(path, fromGroupId, groupId);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(prev => ({ ...prev, visible: false }));
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const openMenu = useCallback((e: React.MouseEvent, tabPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 280;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    setContextMenu({ visible: true, x, y, tabPath });
  }, []);

  const closeMenu = () => setContextMenu(prev => ({ ...prev, visible: false }));

  // ── Context menu actions ──────────────────────────────────────────────────
  const handleClose = () => {
    if (contextMenu.tabPath) closeFile(contextMenu.tabPath, { groupId });
    closeMenu();
  };


  const closeSequentially = async (paths: string[]) => {
    for (const path of paths) {
      await closeFile(path, { groupId });
    }
  };

  const handleCloseOthers = () => {
    if (!contextMenu.tabPath) return;
    closeSequentially(openTabs.filter(t => t.path !== contextMenu.tabPath).map(t => t.path));
    closeMenu();
  };

  const handleCloseToRight = () => {
    if (!contextMenu.tabPath) return;
    const idx = openTabs.findIndex(t => t.path === contextMenu.tabPath);
    closeSequentially(openTabs.slice(idx + 1).map(t => t.path));
    closeMenu();
  };

  const handleCloseSaved = () => {
    closeSequentially(openTabs.filter(t => !t.isDirty).map(t => t.path));
    closeMenu();
  };

  const handleCloseAll = () => {
    closeSequentially(openTabs.map(t => t.path));
    closeMenu();
  };

  const handleCopyPath = () => {
    if (contextMenu.tabPath) {
      navigator.clipboard.writeText(contextMenu.tabPath).catch(() => { });
    }
    closeMenu();
  };

  const handleCopyRelativePath = () => {
    if (contextMenu.tabPath) {
      const ws = useWorkspaceStore.getState().workspacePath || '';
      const rel = contextMenu.tabPath.startsWith(ws)
        ? contextMenu.tabPath.slice(ws.length).replace(/^[\\\/]/, '')
        : contextMenu.tabPath;
      navigator.clipboard.writeText(rel.replace(/\\/g, '/')).catch(() => { });
    }
    closeMenu();
  };

  const isLast = contextMenu.tabPath
    ? openTabs[openTabs.length - 1]?.path === contextMenu.tabPath
    : false;

  const targetTab = openTabs.find(t => t.path === contextMenu.tabPath);

  return (
    <>
      {/* ── Tab Strip ─────────────────────────────────────────────────────── */}
      <div className="sde-tab-strip">
        <div className="sde-tab-strip-tabs">
          {openTabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            return (
              <div
                key={tab.path}
                draggable
                onDragStart={(e) => handleDragStart(e, tab.path)}
                onDragOver={(e) => handleDragOverTab(e, tab.path)}
                onDragLeave={() => setDragOverPath((p) => (p === tab.path ? null : p))}
                onDrop={handleDropOnTab}
                onClick={() => setActiveTab(tab.path, groupId)}
                onDoubleClick={(e) => openMenu(e, tab.path)}
                onContextMenu={(e) => openMenu(e, tab.path)}
                className={`sde-tab-item${isActive ? ' active' : ''}${dragOverPath === tab.path ? ' sde-tab-item--drag-over' : ''}`}
              >
                {/* File icon */}
                {tab.isSettings ? (
                  tab.settingsType === 'shortcuts' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="sde-tab-icon">
                      <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                      <line x1="6" y1="8" x2="6.01" y2="8"></line><line x1="10" y1="8" x2="10.01" y2="8"></line>
                      <line x1="14" y1="8" x2="14.01" y2="8"></line><line x1="18" y1="8" x2="18.01" y2="8"></line>
                      <line x1="6" y1="12" x2="6.01" y2="12"></line><line x1="10" y1="12" x2="10.01" y2="12"></line>
                      <line x1="14" y1="12" x2="14.01" y2="12"></line><line x1="18" y1="12" x2="18.01" y2="12"></line>
                      <line x1="7" y1="16" x2="17" y2="16"></line>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="sde-tab-icon">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                  )
                ) : (
                  <img src={getFileIconUrl(tab.name, iconMap)} alt="" className="sde-tab-icon" />
                )}

                {/* Label */}
                <span className="sde-tab-label">{tab.name}</span>

                {/* Dirty indicator */}
                {tab.isDirty && <span className="sde-tab-dirty-dot" />}

                {/* Close button */}
                <button
                  className="sde-tab-close-btn"
                  onClick={(e) => { e.stopPropagation(); closeFile(tab.path, { groupId }); }}
                  aria-label={`Close ${tab.name}`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Group actions ──────────────────────────────────────────────── */}
        <div className="sde-tab-strip-actions">
          <button
            className="sde-tab-strip-action-btn"
            title="Split Editor Right"
            onClick={() => useWorkspaceStore.getState().splitEditorGroup(groupId)}
            disabled={openTabs.length === 0}
          >
            <Columns2 size={14} />
          </button>
          {!isOnlyGroup && (
            <button
              className="sde-tab-strip-action-btn"
              title="Close Editor Group"
              onClick={() => useWorkspaceStore.getState().closeEditorGroup(groupId)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>


      {contextMenu.visible && createPortal(
        <div
          ref={menuRef}
          className="sde-tabbar-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="sde-menu-item" onClick={handleClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </button>

          <button
            className="sde-menu-item"
            onClick={handleCloseOthers}
            disabled={openTabs.length <= 1}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              <line x1="4" y1="12" x2="2" y2="12" /><line x1="22" y1="12" x2="20" y2="12" />
            </svg>
            Close Others
          </button>

          <button
            className="sde-menu-item"
            onClick={handleCloseToRight}
            disabled={isLast}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Close to the Right
          </button>

          <div className="sde-separator" />

          <button className="sde-menu-item" onClick={handleCloseSaved}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Close Saved
          </button>

          <button className="sde-menu-item sde-menu-item--danger" onClick={handleCloseAll}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close All
          </button>

          {targetTab && !targetTab.isSettings && (
            <>
              <div className="sde-separator" />
              <button className="sde-menu-item" onClick={handleCopyPath}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy Path
              </button>
              <button className="sde-menu-item" onClick={handleCopyRelativePath}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Copy Relative Path
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
};
