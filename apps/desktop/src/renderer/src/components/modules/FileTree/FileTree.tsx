import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './FileTree.css';
import { useWorkspaceStore, type FileNode } from '../../../store/workspace';
import { useTerminalStore } from '../../../store/terminal';
import { useCodeMapStore } from '../../../store/codeMapStore';
import { FileTreeNode } from './FileTreeNode';
import { InlineInputNode } from './InlineInputNode';
import { Button } from '../../common/Button';
import {
  FilePlus, FolderPlus, Pencil, Trash2, Files, Link2, FolderOpen, TerminalSquare, FolderMinus, History, Share2,
} from 'lucide-react';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  node: FileNode | null;
}

const parentDirOf = (node: FileNode) =>
  node.isDirectory ? node.path : node.path.split(/[/\\]/).slice(0, -1).join('/');

export const FileTree: React.FC = () => {
  const { fileTree, workspacePath, workspaceFolders, creatingNode } = useWorkspaceStore();
  const isMultiRoot = workspaceFolders.length > 1;
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, node: null });
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

  const openMenu = useCallback((node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    setContextMenu({ visible: true, x, y, node });
  }, []);

  const closeMenu = () => setContextMenu((prev) => ({ ...prev, visible: false }));

  const handleOpenWorkspace = async () => {
    const api = window.api;
    if (api && api.openFolder) {
      const proj = await api.openFolder();
      if (proj) {
        useWorkspaceStore.getState().setWorkspace(proj.name, proj.path);
      }
    }
  };

  // ── Context menu actions ────────────────────────────────────────────────
  const handleNewFile = () => {
    if (!contextMenu.node) return;
    useWorkspaceStore.setState({ lastSelectedFolderPath: parentDirOf(contextMenu.node) });
    useWorkspaceStore.getState().startCreatingNode('file');
    closeMenu();
  };

  const handleNewFolder = () => {
    if (!contextMenu.node) return;
    useWorkspaceStore.setState({ lastSelectedFolderPath: parentDirOf(contextMenu.node) });
    useWorkspaceStore.getState().startCreatingNode('folder');
    closeMenu();
  };

  const handleRename = () => {
    if (contextMenu.node) useWorkspaceStore.getState().startRenamingNode(contextMenu.node.path);
    closeMenu();
  };

  const handleDelete = () => {
    if (contextMenu.node) useWorkspaceStore.getState().deleteNode(contextMenu.node.path);
    closeMenu();
  };

  const handleCopyPath = () => {
    if (contextMenu.node) navigator.clipboard.writeText(contextMenu.node.path).catch(() => {});
    closeMenu();
  };

  const handleCopyRelativePath = () => {
    if (contextMenu.node) {
      const ws = workspacePath || '';
      const rel = contextMenu.node.path.startsWith(ws)
        ? contextMenu.node.path.slice(ws.length).replace(/^[\\/]/, '')
        : contextMenu.node.path;
      navigator.clipboard.writeText(rel.replace(/\\/g, '/')).catch(() => {});
    }
    closeMenu();
  };

  const handleReveal = () => {
    if (contextMenu.node) useWorkspaceStore.getState().revealInExplorer(contextMenu.node.path);
    closeMenu();
  };

  const handleOpenTerminal = () => {
    if (!contextMenu.node) return;
    const dir = parentDirOf(contextMenu.node);
    useTerminalStore.getState().toggleTerminalPanel(true);
    useTerminalStore.getState().createNewTerminal(dir);
    closeMenu();
  };

  const handleRemoveFolder = () => {
    if (contextMenu.node) useWorkspaceStore.getState().removeFolderFromWorkspace(contextMenu.node.path);
    closeMenu();
  };

  const handleShowLocalHistory = () => {
    const node = contextMenu.node;
    if (!node) return;
    const owningFolder = workspaceFolders.find((f) => node.path === f.path || node.path.startsWith(f.path + '/') || node.path.startsWith(f.path + '\\'));
    if (owningFolder) useWorkspaceStore.getState().openLocalHistoryTab(node.path, owningFolder.path);
    closeMenu();
  };

  // Impact Report is a bottom-panel tab, not an editor tab, so this uses openPanelTab rather than the other actions' editor-tab helpers.
  const handleAnalyzeImpact = () => {
    const node = contextMenu.node;
    if (!node) return;
    useCodeMapStore.getState().setImpactTarget(node.path);
    useTerminalStore.getState().openPanelTab('impact-report');
    closeMenu();
  };

  const isWorkspaceRoot = (node: FileNode) => workspaceFolders.some((f) => f.path === node.path);

  if (!workspacePath) {
    return (
      <div className="sde-file-tree-empty">
        <p>No project opened.</p>
        <Button onClick={handleOpenWorkspace} variant="primary">
          Open Folder
        </Button>
      </div>
    );
  }

  // Single-root workspaces render contents directly at depth 0 (no header); multi-root ones render each root as its own expandable section.
  const singleRootChildren = !isMultiRoot ? (fileTree[0]?.children ?? []) : null;

  return (
    <>
      <div className="sde-file-tree">
        {isMultiRoot ? (
          fileTree.map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} onContextMenu={openMenu} />
          ))
        ) : (
          <>
            {creatingNode && creatingNode.parentPath === workspacePath && (
              <InlineInputNode type={creatingNode.type} depth={0} />
            )}
            {(singleRootChildren?.length ?? 0) === 0 && (!creatingNode || creatingNode.parentPath !== workspacePath) ? (
              <p className="sde-muted-note">Empty directory</p>
            ) : (
              singleRootChildren?.map((node) => (
                <FileTreeNode key={node.path} node={node} depth={0} onContextMenu={openMenu} />
              ))
            )}
          </>
        )}
      </div>

      {/* Portaled to document.body — see TabBar.tsx's identical context menu
          for why (a render-isolated ancestor otherwise misplaces a
          position:fixed menu). */}
      {contextMenu.visible && contextMenu.node && createPortal(
        <div ref={menuRef} className="sde-filetree-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button className="sde-menu-item" onClick={handleNewFile}>
            <FilePlus size={13} /> New File
          </button>
          <button className="sde-menu-item" onClick={handleNewFolder}>
            <FolderPlus size={13} /> New Folder
          </button>

          <div className="sde-separator" />

          <button className="sde-menu-item" onClick={handleRename}>
            <Pencil size={13} /> Rename
          </button>
          <button className="sde-menu-item sde-menu-item--danger" onClick={handleDelete}>
            <Trash2 size={13} /> Delete
          </button>

          <div className="sde-separator" />

          <button className="sde-menu-item" onClick={handleCopyPath}>
            <Files size={13} /> Copy Path
          </button>
          <button className="sde-menu-item" onClick={handleCopyRelativePath}>
            <Link2 size={13} /> Copy Relative Path
          </button>

          <div className="sde-separator" />

          <button className="sde-menu-item" onClick={handleReveal}>
            <FolderOpen size={13} /> Reveal in File Explorer
          </button>
          <button className="sde-menu-item" onClick={handleOpenTerminal}>
            <TerminalSquare size={13} /> Open in Integrated Terminal
          </button>

          {!contextMenu.node.isDirectory && (
            <button className="sde-menu-item" onClick={handleShowLocalHistory}>
              <History size={13} /> Show Local History
            </button>
          )}

          {!contextMenu.node.isDirectory && (
            <button className="sde-menu-item" onClick={handleAnalyzeImpact}>
              <Share2 size={13} /> Analyze Impact
            </button>
          )}

          {isWorkspaceRoot(contextMenu.node) && (
            <>
              <div className="sde-separator" />
              <button className="sde-menu-item sde-menu-item--danger" onClick={handleRemoveFolder}>
                <FolderMinus size={13} /> Remove Folder from Workspace
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
};
