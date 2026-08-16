import React, { useEffect, useRef, useState } from 'react';
import './TabSwitcher.css';
import { useWorkspaceStore, getTabSwitchOrder } from '../../../store/workspace';
import { FileText } from 'lucide-react';

interface SwitcherState {
  open: boolean;
  paths: string[];
  index: number;
}

/**
 * Held-Ctrl, MRU-ordered tab cycling (Ctrl+Tab / Ctrl+Shift+Tab) — a smaller cousin of
 * QuickOpenDialog. All cycling state lives in a ref (not React state) so rapid repeated
 * keydowns are never lost to a stale closure from an in-flight re-render; the ref is
 * only mirrored into state to drive what's rendered.
 */
export const TabSwitcherOverlay: React.FC = () => {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<{ paths: string[]; index: number }>({ paths: [], index: 0 });
  const stateRef = useRef<SwitcherState>({ open: false, paths: [], index: 0 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (s.open && e.key === 'Escape') {
        e.preventDefault();
        s.open = false;
        setVisible(false);
        return;
      }
      if (!e.ctrlKey || e.key !== 'Tab') return;
      e.preventDefault();
      if (!s.open) {
        const order = getTabSwitchOrder();
        if (order.length < 2) return;
        s.open = true;
        s.paths = order;
        s.index = 1;
      } else {
        s.index = (s.index + (e.shiftKey ? -1 : 1) + s.paths.length) % s.paths.length;
      }
      setVisible(true);
      setDisplay({ paths: s.paths, index: s.index });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Control') return;
      const s = stateRef.current;
      if (!s.open) return;
      const selected = s.paths[s.index];
      s.open = false;
      setVisible(false);
      if (selected) setActiveTab(selected);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [setActiveTab]);

  if (!visible) return null;

  const tabsByPath = new Map(openTabs.map((t) => [t.path, t]));

  return (
    <div className="sde-tabswitcher-overlay">
      <div className="sde-tabswitcher-list">
        {display.paths.map((path, i) => {
          const tab = tabsByPath.get(path);
          if (!tab) return null;
          return (
            <div key={path} className={`sde-tabswitcher-item${i === display.index ? ' active' : ''}`}>
              <FileText size={13} className="sde-tabswitcher-item-icon" />
              <span className="sde-tabswitcher-item-name">{tab.name}</span>
              <span className="sde-tabswitcher-item-path">{tab.path}</span>
            </div>
          );
        })}
      </div>
      <div className="sde-tabswitcher-hint">Hold Ctrl, tap Tab to cycle, release to select · Esc to cancel</div>
    </div>
  );
};
