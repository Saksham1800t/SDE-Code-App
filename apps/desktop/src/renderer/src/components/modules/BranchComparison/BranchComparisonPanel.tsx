import React, { useEffect, useState } from 'react';
import './BranchComparison.css';
import { useGitStore } from '../../../store/git';
import { getStatusMeta } from '../GitPanel/GitFileRow';

export const BranchComparisonPanel: React.FC = () => {
  const { gitBranches, gitLoadBranches, branchComparison, gitLoadBranchComparison, gitOpenBranchFileDiff } = useGitStore();
  const [branchA, setBranchA] = useState('');
  const [branchB, setBranchB] = useState('');
  const [compared, setCompared] = useState<{ a: string; b: string } | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    gitLoadBranches();
  }, []);

  useEffect(() => {
    if (!gitBranches || branchA || branchB) return;
    const other = gitBranches.local.find((b) => b !== gitBranches.current);
    setBranchA(gitBranches.current);
    setBranchB(other || gitBranches.current);
  }, [gitBranches]);

  const handleCompare = async () => {
    if (!branchA || !branchB) return;
    setComparing(true);
    try {
      await gitLoadBranchComparison(branchA, branchB);
      setCompared({ a: branchA, b: branchB });
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="sde-branch-comparison-panel">
      <div className="sde-branch-comparison-container">
        <div className="sde-branch-comparison-title">Compare Branches</div>

        <div className="sde-branch-comparison-picker">
          <select className="sde-branch-comparison-select" value={branchA} onChange={(e) => setBranchA(e.target.value)}>
            {gitBranches?.local.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <span className="sde-branch-comparison-arrow">...</span>
          <select className="sde-branch-comparison-select" value={branchB} onChange={(e) => setBranchB(e.target.value)}>
            {gitBranches?.local.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button
            className="sde-branch-comparison-compare-btn"
            onClick={handleCompare}
            disabled={comparing || !branchA || !branchB}
          >
            {comparing ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        {compared && (
          <>
            <div className="sde-branch-comparison-section-label">
              Changed Files{branchComparison ? ` (${branchComparison.length})` : ''}
            </div>

            {branchComparison === null ? (
              <div className="sde-branch-comparison-loading">Loading diff...</div>
            ) : branchComparison.length === 0 ? (
              <div className="sde-branch-comparison-empty">No differences between these branches.</div>
            ) : (
              <div className="sde-branch-comparison-file-list">
                {branchComparison.map((file) => {
                  const status = getStatusMeta(file.statusText);
                  const fileName = file.path.split('/').pop() || file.path;
                  return (
                    <div
                      key={file.path}
                      className="sde-branch-comparison-file-row"
                      onClick={() => gitOpenBranchFileDiff(compared.a, compared.b, file.path, fileName)}
                    >
                      <span className="sde-branch-comparison-file-status" style={{ color: status.color }}>{status.char}</span>
                      <div className="sde-branch-comparison-file-info">
                        <span className="sde-branch-comparison-file-name">{fileName}</span>
                        <span className="sde-branch-comparison-file-path">
                          {file.fromPath ? `${file.fromPath} → ${file.path}` : file.path}
                        </span>
                      </div>
                      <span className="sde-branch-comparison-file-stats">
                        <span className="sde-branch-comparison-file-ins">+{file.insertions}</span>
                        <span className="sde-branch-comparison-file-del">-{file.deletions}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
