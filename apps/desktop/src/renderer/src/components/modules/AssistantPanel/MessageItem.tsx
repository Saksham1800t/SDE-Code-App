import React, { useState } from 'react';
import './AssistantPanel.css';
import { Settings, AlertTriangle, Check, X, FileInput, Copy, ThumbsUp, ThumbsDown } from 'lucide-react';

export interface Message {
  role: 'user' | 'assistant' | 'tool-progress' | 'approval-request';
  content: string;
  isStreaming?: boolean;
  approval?: { requestId: string; toolName: string; argsSummary: string; resolved?: 'approved' | 'denied' };
  timestamp?: number;
}

interface MessageItemProps {
  msg: Message;
  onApprovalResponse?: (requestId: string, approved: boolean) => void;
  onInsertToEditor?: (content: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ msg, onApprovalResponse, onInsertToEditor }) => {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  if (msg.role === 'tool-progress') {
    return (
      <div className="sde-msg-tool-progress">
        <span className="sde-msg-tool-progress-icon"><Settings size={12} /></span>
        {msg.content}
      </div>
    );
  }

  if (msg.role === 'approval-request' && msg.approval) {
    const { requestId, toolName, argsSummary, resolved } = msg.approval;
    const label = toolName === 'run_terminal_command' ? 'Agent wants to run a command' : `Agent wants to run ${toolName}`;
    return (
      <div className="sde-msg-approval-request">
        <div className="sde-msg-approval-label"><AlertTriangle size={12} /> {label}</div>
        <pre className="sde-msg-approval-command">{argsSummary}</pre>
        {resolved ? (
          <div className={`sde-msg-approval-resolved sde-msg-approval-resolved--${resolved}`}>
            {resolved === 'approved' ? <><Check size={12} /> Approved</> : <><X size={12} /> Denied</>}
          </div>
        ) : (
          <div className="sde-msg-approval-actions">
            <button className="sde-btn sde-btn--primary sde-btn--sm" onClick={() => onApprovalResponse?.(requestId, true)}>
              Approve
            </button>
            <button className="sde-btn sde-btn--danger sde-btn--sm" onClick={() => onApprovalResponse?.(requestId, false)}>
              Deny
            </button>
          </div>
        )}
      </div>
    );
  }

  const isUser = msg.role === 'user';

  const renderMessageContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.split('\n');
        const firstLine = lines[0].replace('```', '').trim();
        const code = lines.slice(1, -1).join('\n');

        return (
          <div key={index} className="sde-msg-code-block">
            <div className="sde-msg-code-header">
              <span>{firstLine || 'code'}</span>
              <button
                className="sde-msg-code-copy-btn"
                onClick={() => navigator.clipboard.writeText(code)}
              >
                Copy
              </button>
            </div>
            <pre className="sde-msg-code-pre"><code>{code}</code></pre>
          </div>
        );
      }

      const inlineParts = part.split(/(`[^`]+`)/g);
      const renderedText = inlineParts.map((subPart, subIndex) => {
        if (subPart.startsWith('`') && subPart.endsWith('`')) {
          return (
            <code key={subIndex} className="sde-msg-inline-code">
              {subPart.slice(1, -1)}
            </code>
          );
        }
        return subPart;
      });

      return (
        <p key={index} style={{ margin: '6px 0', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
          {renderedText}
        </p>
      );
    });
  };

  if (isUser) {
    return (
      <div className="sde-msg-bubble sde-msg-bubble--user">
        {renderMessageContent(msg.content)}
      </div>
    );
  }

  return (
    <div className="sde-msg-group">
      <div className="sde-msg-bubble sde-msg-bubble--assistant">
        {renderMessageContent(msg.content)}
        {msg.isStreaming && <span className="sde-msg-streaming-cursor" />}
      </div>

      {!msg.isStreaming && (
        <div className="sde-msg-actions">
          <button className="sde-msg-action-btn" onClick={() => onInsertToEditor?.(msg.content)} title="Insert into editor">
            <FileInput size={12} />
          </button>
          <button className="sde-msg-action-btn" onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy">
            <Copy size={12} />
          </button>
          <button
            className={`sde-msg-action-btn${feedback === 'up' ? ' active' : ''}`}
            onClick={() => setFeedback((f) => (f === 'up' ? null : 'up'))}
            title="Good response"
          >
            <ThumbsUp size={12} />
          </button>
          <button
            className={`sde-msg-action-btn${feedback === 'down' ? ' active' : ''}`}
            onClick={() => setFeedback((f) => (f === 'down' ? null : 'down'))}
            title="Bad response"
          >
            <ThumbsDown size={12} />
          </button>
        </div>
      )}
    </div>
  );
};
