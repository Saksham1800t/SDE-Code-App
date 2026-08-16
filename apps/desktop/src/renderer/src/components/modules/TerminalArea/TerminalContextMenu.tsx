import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Play, FileCode, FolderClock, History } from 'lucide-react';

interface TerminalContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onClear: () => void;
  onRunSelectedText: () => void;
  onRunActiveFile: () => void;
  onGoToRecentDirectory: () => void;
  onRunRecentCommand: () => void;
  hasSelection: boolean;
  hasActiveFile: boolean;
  hasCwdHistory: boolean;
  hasCommandHistory: boolean;
}

export const TerminalContextMenu: React.FC<TerminalContextMenuProps> = ({
  x, y, onClose, onClear, onRunSelectedText, onRunActiveFile, onGoToRecentDirectory, onRunRecentCommand,
  hasSelection, hasActiveFile, hasCwdHistory, hasCommandHistory,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

  const run = (fn: () => void) => () => { fn(); onClose(); };

  return createPortal(
    <div ref={menuRef} className="sde-tabbar-context-menu" style={{ top: y, left: x }}>
      <button className="sde-menu-item" onClick={run(onClear)}>
        <Eraser size={13} /> Clear Terminal
      </button>
      <div className="sde-separator" />
      <button className="sde-menu-item" disabled={!hasSelection} onClick={run(onRunSelectedText)}>
        <Play size={13} /> Run Selected Text
      </button>
      <button className="sde-menu-item" disabled={!hasActiveFile} onClick={run(onRunActiveFile)}>
        <FileCode size={13} /> Run Active File
      </button>
      <div className="sde-separator" />
      <button className="sde-menu-item" disabled={!hasCwdHistory} onClick={run(onGoToRecentDirectory)}>
        <FolderClock size={13} /> Go to Recent Directory…
      </button>
      <button className="sde-menu-item" disabled={!hasCommandHistory} onClick={run(onRunRecentCommand)}>
        <History size={13} /> Run Recent Command…
      </button>
    </div>,
    document.body,
  );
};
