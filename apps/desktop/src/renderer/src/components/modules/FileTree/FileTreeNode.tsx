import React, { useEffect, useMemo, useState } from 'react';
import './FileTree.css';
import { useWorkspaceStore, FileNode } from '../../../store/workspace';
import { useGitStore } from '../../../store/git';
import { getStatusMeta } from '../GitPanel/GitFileRow';
import { getFileIconUrl, getFolderIconUrl } from '../../../utils/fileIcons';
import { InlineInputNode } from './InlineInputNode';
import { useThemeStore } from '../../../store/theme';

interface NodeProps {
  node: FileNode;
  depth: number;
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
}

const FALLBACK_FOLDER_PATH = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
const FALLBACK_FILE_PATH = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z';

/** Remote CDN icon with a local SVG fallback; renders exactly one via state, not an imperative DOM append that stacked duplicates on re-render. */
const TreeIcon: React.FC<{ url: string; fallbackPath: string; fallbackColor: string }> = ({ url, fallbackPath, fallbackColor }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [url]);

  if (failed) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={fallbackColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={fallbackPath} />
      </svg>
    );
  }

  return <img src={url} alt="" onError={() => setFailed(true)} />;
};

const RenameInput: React.FC<{ node: FileNode }> = ({ node }) => {
  const { renameNode, cancelRenamingNode } = useWorkspaceStore();
  const [value, setValue] = useState(node.name);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isCommittedRef = React.useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Pre-select the base name (not the extension), matching VS Code's rename UX.
    if (!node.isDirectory) {
      const dot = node.name.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : node.name.length);
    } else {
      el.select();
    }
  }, []);

  const commit = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== node.name) renameNode(node.path, trimmed);
    cancelRenamingNode();
  };

  const cancel = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    cancelRenamingNode();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') cancel();
      }}
      className="sde-inline-input"
    />
  );
};

export const FileTreeNode: React.FC<NodeProps> = ({ node, depth, onContextMenu }) => {
  const { toggleFolder, openFile, activeTabPath, creatingNode, renamingPath } = useWorkspaceStore();
  const gitRepoStatus = useGitStore((s) => s.gitRepoStatus);
  const iconMap = useThemeStore((s) => (s.extensionThemes[s.currentTheme] ?? s.localThemes[s.currentTheme])?.iconMap);

  // GitFile.path is a native (Windows-backslash) path unlike node.path, so normalize before comparing; folders aggregate from the flat status list since unloaded children can't be walked.
  const gitStatusMeta = useMemo(() => {
    if (!gitRepoStatus) return null;
    if (node.isDirectory) {
      const prefix = `${node.path}/`;
      const match = gitRepoStatus.files.find((f) => f.path.replace(/\\/g, '/').startsWith(prefix));
      return match ? getStatusMeta(match.statusText) : null;
    }
    const match = gitRepoStatus.files.find((f) => f.path.replace(/\\/g, '/') === node.path);
    return match ? getStatusMeta(match.statusText) : null;
  }, [gitRepoStatus, node.path, node.isDirectory]);

  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      toggleFolder(node.path);
    } else {
      const parts = node.path.split(/[/\\]/);
      parts.pop();
      const parentPath = parts.join('/');
      useWorkspaceStore.setState({ lastSelectedFolderPath: parentPath });
      openFile(node.path, node.name);
    }
  };

  const isSelected = activeTabPath === node.path;
  const isRenaming = renamingPath === node.path;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        onClick={handleNodeClick}
        onContextMenu={(e) => onContextMenu(node, e)}
        className={`sde-tree-node${isSelected ? ' active' : ''}`}
        style={{ paddingLeft: `${depth * 8 + 8}px` }}
      >
        <span className={`sde-tree-arrow${node.isOpen ? ' open' : ''}${!node.isDirectory ? ' hidden' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </span>

        <span className="sde-tree-icon">
          {node.isDirectory ? (
            <TreeIcon
              url={getFolderIconUrl(node.name, !!node.isOpen)}
              fallbackPath={FALLBACK_FOLDER_PATH}
              fallbackColor={node.isOpen ? '#e2c08d' : '#dcb67a'}
            />
          ) : (
            <TreeIcon
              url={getFileIconUrl(node.name, iconMap)}
              fallbackPath={FALLBACK_FILE_PATH}
              fallbackColor="#7aa2f7"
            />
          )}
        </span>

        {/* Name — colored by git status when the file/folder has pending
            changes (matching VS Code's Explorer convention: files get a
            colored name + a status-letter badge, folders just get a colored
            name based on the worst change found among their descendants) */}
        {isRenaming ? (
          <RenameInput node={node} />
        ) : (
          <span className="sde-tree-label" style={gitStatusMeta ? { color: gitStatusMeta.color } : undefined}>
            {node.name}
          </span>
        )}

        {!isRenaming && !node.isDirectory && gitStatusMeta && (
          <span className="sde-tree-git-badge" style={{ color: gitStatusMeta.color }}>
            {gitStatusMeta.char}
          </span>
        )}
      </div>

      {node.isDirectory && node.isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {creatingNode && creatingNode.parentPath === node.path && (
            <InlineInputNode type={creatingNode.type} depth={depth + 1} />
          )}
          {node.children && node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  );
};
