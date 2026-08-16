import React, { useState } from 'react';
import './GitPanel.css';
import { Smile, Loader2, Sparkles, Lightbulb, Undo2, Pencil, ArrowUp } from 'lucide-react';

interface GitCommitFormProps {
  commitMessage: string;
  setCommitMessage: (m: string) => void;
  amendMode: boolean;
  setAmendMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  stagedCount: number;
  loading: boolean;
  handleCommit: (e: React.FormEvent) => void;
  handleCommitAndPush: (message: string) => void;
  handleUndoLastCommit: () => void;
  handleAmendLastCommit: (message: string) => void;
  onGenerateAIMessage: () => Promise<void>;
  generatingAI: boolean;
}

// Uniform, neutral by default (not a per-type color rainbow) — the emoji alone tells types apart when emoji mode is on.
const COMMIT_TYPES = [
  { label: 'feat', emoji: '✨' },
  { label: 'fix', emoji: '🐛' },
  { label: 'docs', emoji: '📝' },
  { label: 'refactor', emoji: '♻️' },
  { label: 'test', emoji: '✅' },
  { label: 'chore', emoji: '🔧' },
  { label: 'style', emoji: '💄' },
  { label: 'perf', emoji: '⚡' },
];

function getConventionalCommitValidity(message: string): 'valid' | 'invalid' | 'empty' {
  if (!message.trim()) return 'empty';
  const pattern = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?: .+/;
  return pattern.test(message.trim()) ? 'valid' : 'invalid';
}

export const GitCommitForm: React.FC<GitCommitFormProps> = ({
  commitMessage, setCommitMessage, amendMode, setAmendMode, stagedCount, loading,
  handleCommit, handleCommitAndPush, handleUndoLastCommit, handleAmendLastCommit,
  onGenerateAIMessage, generatingAI
}) => {
  const [emojiMode, setEmojiMode] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const validity = getConventionalCommitValidity(commitMessage);
  const isSubmitDisabled = loading || !commitMessage.trim() || (stagedCount === 0 && !amendMode);

  const applyType = (type: string, emoji: string) => {
    const existing = commitMessage.replace(/^(\w+)(\(.+\))?: /, '');
    const prefix = emojiMode ? `${emoji} ${type}: ` : `${type}: `;
    setCommitMessage(prefix + existing);
  };

  const borderColor =
    validity === 'valid' ? 'var(--accent-cyan)' :
    validity === 'invalid' && commitMessage ? 'color-mix(in srgb, var(--color-warning) 60%, transparent)' :
    'var(--border-color)';

  return (
    <div className="sde-git-commit-form">
      {/* Commit type badges */}
      <div className="sde-git-commit-types-row">
        {COMMIT_TYPES.map(t => (
          <button
            key={t.label}
            onClick={() => applyType(t.label, t.emoji)}
            className="sde-git-commit-type-badge"
          >
            {emojiMode ? `${t.emoji} ` : ''}{t.label}
          </button>
        ))}
        <button
          onClick={() => setEmojiMode(e => !e)}
          title="Toggle emoji mode"
          className={`sde-git-commit-type-badge${emojiMode ? ' active' : ''}`}
        >
          <Smile size={13} />
        </button>
      </div>

      {/* Message textarea + AI button */}
      <div className="sde-git-commit-input-wrapper">
        <textarea
          value={commitMessage}
          onChange={e => setCommitMessage(e.target.value)}
          placeholder={generatingAI ? 'Generating AI commit message…' : 'Commit message (Ctrl+Enter to commit)'}
          rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleCommit(e); }}
          className="sde-git-commit-textarea"
          style={{
            borderColor,
            opacity: generatingAI ? 0.6 : 1
          }}
          disabled={generatingAI}
        />

        {/* AI generate button */}
        <button
          onClick={onGenerateAIMessage}
          disabled={generatingAI}
          title="Generate commit message with AI"
          className="sde-git-commit-ai-btn"
        >
          {generatingAI ? (
            <Loader2 size={14} className="sde-spin" />
          ) : (
            <Sparkles size={14} />
          )}
        </button>

        {/* Validity hint */}
        {commitMessage && validity === 'invalid' && (
          <div className="sde-git-commit-hint">
            <Lightbulb size={12} /> Consider: <code style={{ fontFamily: 'var(--font-mono)' }}>type: description</code>
          </div>
        )}
      </div>

      {/* Amend indicator — persists until unchecked, matching VS Code's own
          SCM input "Amend" action-bar toggle rather than a one-shot prompt */}
      {amendMode && (
        <div className="sde-git-commit-amend-banner">
          <Pencil size={11} /> Amending the last commit
          <button onClick={() => setAmendMode(false)} className="sde-git-commit-amend-cancel">Cancel</button>
        </div>
      )}

      {/* Action buttons */}
      <div className="sde-git-commit-actions">
        {/* Commit / Amend */}
        <button
          onClick={amendMode ? () => handleAmendLastCommit(commitMessage) : (handleCommit as any)}
          disabled={isSubmitDisabled}
          className="sde-git-commit-main-btn"
        >
          {loading ? (amendMode ? 'Amending…' : 'Committing…') : amendMode ? 'Amend Commit' : `Commit (${stagedCount})`}
        </button>

        {/* Commit & Push — not offered while amending (amending rewrites
            history, which needs a force-push the UI doesn't attempt here) */}
        {!amendMode && (
          <button
            onClick={() => handleCommitAndPush(commitMessage)}
            disabled={isSubmitDisabled}
            className="sde-git-commit-push-btn"
          >
            {loading ? '…' : <><ArrowUp size={12} /> Push</>}
          </button>
        )}

        {/* More dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowMore(m => !m)}
            className="sde-git-commit-more-btn"
          >
            ···
          </button>
          {showMore && (
            <div className="sde-git-commit-more-popup">
              {[
                { label: 'Undo Last Commit', icon: <Undo2 size={13} />, active: false, action: () => { handleUndoLastCommit(); setShowMore(false); } },
                { label: 'Amend Last Commit', icon: <Pencil size={13} />, active: amendMode, action: () => { setAmendMode(m => !m); setShowMore(false); } },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className={`sde-git-commit-more-item${item.active ? ' active' : ''}`}
                >
                  <span style={{ opacity: 0.7 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
