import React, { useEffect, useState, useRef } from 'react';
import './StatusBar.css';
import { useStatusBarStore } from '../../../store/statusBar';
import { useCommandsStore } from '../../../store/commands';
import { useGitStore } from '../../../store/git';
import { useExtensionsStore } from '../../../store/extensions';
import { useWorkspaceStore } from '../../../store/workspace';
import { useEditorSettingsStore } from '../../../store/editorSettings';
import { StatusBarIndicator } from './StatusBarIndicator';
import { IndicatorVisibilityMenu } from './IndicatorVisibilityMenu';
import { NotificationBell } from './NotificationBell';
import { setVimStatusBarNode } from '../EditorArea/vimMode';

export const StatusBar: React.FC = () => {
  const { items, initialize, toggleItemVisibility, updateItemText } = useStatusBarStore();
  const { executeCommand } = useCommandsStore();
  const branchName = useGitStore((state) => state.gitRepoStatus?.branch || 'no repo');
  const vimModeEnabled = useEditorSettingsStore((s) => s.vimModeEnabled);
  const vimStatusRef = useRef<HTMLDivElement>(null);

  // Registers/unregisters the real DOM node monaco-vim writes its mode text into — see vimMode.ts's attachVimMode.
  useEffect(() => {
    if (!vimModeEnabled) return;
    setVimStatusBarNode(vimStatusRef.current);
    return () => setVimStatusBarNode(null);
  }, [vimModeEnabled]);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  // Gates the branchName-sync effect so it can't run before the async initialize() overwrites `items` back to its hardcoded default.
  const [isInitialized, setIsInitialized] = useState(false);

  const { extensions } = useExtensionsStore();
  const isGitEnabled = extensions.find((e) => e.id === 'sys.git')?.isEnabled !== false;
  const isAiChatEnabled = extensions.find((e) => e.id === 'sys.aichat')?.isEnabled !== false;
  const workspaceTrustState = useWorkspaceStore((state) => state.workspaceTrustState);

  useEffect(() => {
    initialize().then(() => setIsInitialized(true));
  }, [initialize]);

  useEffect(() => {
    if (!isInitialized) return;
    updateItemText('git-branch', branchName);
  }, [isInitialized, branchName, updateItemText]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (contextMenuPos && contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [contextMenuPos]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const filteredItems = items.filter((item) => {
    if (item.id === 'git-branch' && !isGitEnabled) return false;
    if (item.id === 'ai-provider' && !isAiChatEnabled) return false;
    if (item.id === 'workspace-trust' && workspaceTrustState !== 'restricted') return false;
    return true;
  });

  const leftItems = filteredItems.filter((i) => i.alignment === 'left' && i.visible).sort((a, b) => b.priority - a.priority);
  const rightItems = filteredItems.filter((i) => i.alignment === 'right' && i.visible).sort((a, b) => b.priority - a.priority);

  return (
    <div className="sde-status-bar" onContextMenu={handleContextMenu}>
      <div className="sde-status-bar-group">
        {leftItems.map((item) => (
          <StatusBarIndicator key={item.id} item={item} executeCommand={executeCommand} />
        ))}
        {vimModeEnabled && <div ref={vimStatusRef} className="sde-status-indicator sde-status-vim-indicator" />}
      </div>
      <div className="sde-status-bar-group">
        {rightItems.map((item) => (
          <StatusBarIndicator key={item.id} item={item} executeCommand={executeCommand} />
        ))}
        <NotificationBell />
      </div>
      <IndicatorVisibilityMenu
        items={items}
        toggleItemVisibility={toggleItemVisibility}
        contextMenuPos={contextMenuPos}
        contextMenuRef={contextMenuRef}
      />
    </div>
  );
};
