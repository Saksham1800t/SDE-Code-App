import React from 'react';
import '../CommitDetails/CommitDetails.css';
import { getStatusMeta } from './GitFileRow';
import type { GitCommitFile } from '../../../store/git';

interface CommitFileRowProps {
  file: GitCommitFile;
  onClick: () => void;
}

/** One "file changed in this commit" row, extracted so the sidebar graph's inline file list matches the full-page Commit Details tab exactly. */
export const CommitFileRow: React.FC<CommitFileRowProps> = ({ file, onClick }) => {
  const status = getStatusMeta(file.statusText);
  const fileName = file.path.split('/').pop() || file.path;

  return (
    <div className="sde-commit-details-file-row" onClick={onClick}>
      <span className="sde-commit-details-file-status" style={{ color: status.color }}>{status.char}</span>
      <div className="sde-commit-details-file-info">
        <span className="sde-commit-details-file-name">{fileName}</span>
        <span className="sde-commit-details-file-path">
          {file.fromPath ? `${file.fromPath} → ${file.path}` : file.path}
        </span>
      </div>
      <span className="sde-commit-details-file-stats">
        <span className="sde-commit-details-file-ins">+{file.insertions}</span>
        <span className="sde-commit-details-file-del">-{file.deletions}</span>
      </span>
    </div>
  );
};
