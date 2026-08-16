import React, { useEffect, useState } from 'react';
import './CommitDetails.css';
import { useGitStore } from '../../../store/git';
import { useAgentStore } from '../../../store/agent';
import { CommitFileRow } from '../GitPanel/CommitFileRow';
import { MultiFileDiffView } from './MultiFileDiffView';
import { relativeTime } from '../../../utils/relativeTime';
import { oneShotAIQuery } from '../../../utils/oneShotAIQuery';
import { Button } from '../../common/Button';
import { Sparkles, Rows3, List } from 'lucide-react';

interface CommitDetailsPanelProps {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export const CommitDetailsPanel: React.FC<CommitDetailsPanelProps> = ({ hash, shortHash, message, author, date }) => {
  const { commitFiles, gitLoadCommitFiles, gitOpenCommitFileDiff, gitGetCommitPatch } = useGitStore();
  const { activeAIProvider, activeAIModel } = useAgentStore();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [viewAllChanges, setViewAllChanges] = useState(false);

  useEffect(() => {
    gitLoadCommitFiles(hash);
    setAiSummary(null);
    setSummaryError(null);
    setViewAllChanges(false);
  }, [hash]);

  const handleSummarize = async () => {
    setGeneratingSummary(true);
    setSummaryError(null);
    try {
      const patch = await gitGetCommitPatch(hash);
      const prompt = `Summarize what this commit changes in plain English, focusing on intent and impact rather than mechanical line-by-line detail. Keep it to 2-4 sentences.\n\nCommit message: ${message}\n\n${patch.slice(0, 8000)}`;
      const summary = await oneShotAIQuery(activeAIProvider, activeAIModel, prompt);
      setAiSummary(summary);
    } catch (err: any) {
      setSummaryError(err.message || 'Failed to generate summary.');
    } finally {
      setGeneratingSummary(false);
    }
  };

  return (
    <div className="sde-commit-details-panel">
      <div className="sde-commit-details-container">
        <div className="sde-commit-details-title">Commit Details</div>

        <div className="sde-commit-details-header">
          <code className="sde-commit-details-hash">{shortHash}</code>
          <div className="sde-commit-details-message">{message}</div>
          <div className="sde-commit-details-meta">{author} · {relativeTime(date)}</div>
        </div>

        <div className="sde-commit-details-section-label">AI Summary</div>
        {aiSummary ? (
          <div className="sde-commit-details-ai-summary">{aiSummary}</div>
        ) : (
          <Button onClick={handleSummarize} disabled={generatingSummary} size="sm">
            {generatingSummary ? 'Summarizing…' : <><Sparkles size={13} /> Summarize with AI</>}
          </Button>
        )}
        {summaryError && <div className="sde-commit-details-empty">{summaryError}</div>}

        <div className="sde-commit-details-files-header">
          <div className="sde-commit-details-section-label">
            Changed Files{commitFiles ? ` (${commitFiles.length})` : ''}
          </div>
          {commitFiles && commitFiles.length > 0 && (
            <button
              className="sde-btn sde-btn--secondary sde-btn--sm"
              onClick={() => setViewAllChanges((v) => !v)}
              title={viewAllChanges ? 'Show file list' : 'Show every file\'s diff in one scroll'}
            >
              {viewAllChanges ? <List size={12} /> : <Rows3 size={12} />}
              {viewAllChanges ? 'File List' : 'View All Changes'}
            </button>
          )}
        </div>

        {commitFiles === null ? (
          <div className="sde-commit-details-loading">Loading changed files...</div>
        ) : commitFiles.length === 0 ? (
          <div className="sde-commit-details-empty">No changed files.</div>
        ) : viewAllChanges ? (
          <MultiFileDiffView hash={hash} files={commitFiles} />
        ) : (
          <div className="sde-commit-details-file-list">
            {commitFiles.map((file) => {
              const fileName = file.path.split('/').pop() || file.path;
              return (
                <CommitFileRow
                  key={file.path}
                  file={file}
                  onClick={() => gitOpenCommitFileDiff(hash, file.path, fileName)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
