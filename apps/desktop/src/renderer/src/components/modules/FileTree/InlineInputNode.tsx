import React, { useState, useEffect, useRef } from 'react';
import './FileTree.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { getFileIconUrl, getFolderIconUrl } from '../../../utils/fileIcons';

interface InlineInputNodeProps {
  type: 'file' | 'folder';
  depth: number;
}

export const InlineInputNode: React.FC<InlineInputNodeProps> = ({ type, depth }) => {
  const [value, setValue] = useState('');
  const { commitCreatingNode, cancelCreatingNode } = useWorkspaceStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const isCommittedRef = useRef(false);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleCommit = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    if (!value.trim()) cancelCreatingNode();
    else commitCreatingNode(value.trim());
  };

  const handleCancel = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;
    cancelCreatingNode();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleCommit();
    else if (e.key === 'Escape') handleCancel();
  };

  return (
    <div className="sde-tree-inline-input-row" style={{ paddingLeft: `${depth * 8 + 8}px` }}>
      <span style={{ marginRight: '8px', display: 'flex', alignItems: 'center', opacity: 0.8, width: '16px', height: '16px' }}>
        {type === 'folder' ? (
          <img src={getFolderIconUrl('', false)} alt="folder" style={{ width: '16px', height: '16px' }} />
        ) : (
          <img src={getFileIconUrl('')} alt="file" style={{ width: '16px', height: '16px' }} />
        )}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        className="sde-inline-input"
      />
    </div>
  );
};
