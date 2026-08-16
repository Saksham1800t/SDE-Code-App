import React, { useState } from 'react';
import './ThreadsPanel.css';
import { useThreadsStore } from '../../../store/threads';
import { Trash2, Square } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  starting: 'Starting…',
  running: 'Running',
  done: 'Done',
  error: 'Error',
  stopped: 'Stopped',
};

/**
 * Parallel Agent Threads — each thread runs its own agentQuery against an
 * isolated git worktree (see store/threads.ts's startThread), fully
 * independent of the main AI Assistant panel and of every other thread:
 * separate sessionId (separate abort scope, separate chunk/event stream —
 * see AiQueryOptions.sessionId), separate working directory (separate
 * uncommitted changes, via GitService.createWorktree).
 */
export const ThreadsPanel: React.FC = () => {
  const { threads, order, activeThreadId, setActiveThread, startThread, respondApproval, stopThread, discardThread } = useThreadsStore();
  const [promptInput, setPromptInput] = useState('');

  const activeThread = activeThreadId ? threads[activeThreadId] : undefined;

  const handleStart = () => {
    const prompt = promptInput.trim();
    if (!prompt) return;
    setPromptInput('');
    void startThread(prompt);
  };

  return (
    <div className="sde-threads-panel">
      <div className="sde-threads-list">
        <div className="sde-threads-new">
          <input
            placeholder="Start a new thread…"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
          />
        </div>
        {order.length === 0 ? (
          <div className="sde-threads-empty">No threads yet. Each thread runs independently in its own isolated git worktree.</div>
        ) : (
          order.map((id) => {
            const thread = threads[id];
            if (!thread) return null;
            return (
              <div
                key={id}
                className={`sde-thread-item${id === activeThreadId ? ' sde-thread-item--active' : ''}`}
                onClick={() => setActiveThread(id)}
              >
                <span className={`sde-thread-item-dot sde-thread-item-dot--${thread.status}`} />
                <span className="sde-thread-item-title">{thread.title}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="sde-thread-detail">
        {!activeThread ? (
          <div className="sde-threads-empty">Select a thread, or start a new one.</div>
        ) : (
          <>
            <div className="sde-thread-detail-header">
              <span>{STATUS_LABEL[activeThread.status] ?? activeThread.status}{activeThread.error ? `: ${activeThread.error}` : ''}</span>
              <span className="sde-thread-detail-meta">{activeThread.branchName}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {(activeThread.status === 'running' || activeThread.status === 'starting') && (
                  <button className="sde-icon-btn" title="Stop Thread" onClick={() => stopThread(activeThread.id)}>
                    <Square size={13} />
                  </button>
                )}
                <button className="sde-icon-btn sde-icon-btn--danger" title="Discard Thread (deletes its worktree)" onClick={() => void discardThread(activeThread.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="sde-thread-detail-body">
              <div className="sde-thread-msg">{activeThread.prompt}</div>
              {activeThread.messages.map((msg, i) =>
                msg.role === 'approval' && msg.approval ? (
                  <div key={i} className="sde-thread-approval">
                    <div className="sde-thread-approval-cmd">{msg.approval.argsSummary}</div>
                    {msg.approval.resolved ? (
                      <span>{msg.approval.resolved === 'approved' ? 'Approved' : 'Denied'}</span>
                    ) : (
                      <div className="sde-thread-approval-actions">
                        <button className="sde-btn sde-btn--primary sde-btn--sm" onClick={() => respondApproval(activeThread.id, msg.approval!.requestId, true)}>Approve</button>
                        <button className="sde-btn sde-btn--sm" onClick={() => respondApproval(activeThread.id, msg.approval!.requestId, false)}>Deny</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={i} className={`sde-thread-msg${msg.role === 'tool' ? ' sde-thread-msg--tool' : ''}`}>{msg.text}</div>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
