import React, { useEffect, useRef, useState } from 'react';
import './InlineChatWidget.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useAgentStore } from '../../../store/agent';
import { extractCodeBlock } from '../AssistantPanel/utils';
import { buildInlineChatPrompt, applyInlineChatEdit } from '../../../utils/inlineChatPrompt';
import { Sparkles, Loader2 } from 'lucide-react';

interface InlineChatWidgetProps {
  editor: any;
  groupId: string;
  onClose: () => void;
}

/** Ctrl+I "edit in place" — splices the AI's scoped snippet into the file and reuses Edit Code's pendingAIEdits/Accept-Discard flow instead of a second review UI. */
export const InlineChatWidget: React.FC<InlineChatWidgetProps> = ({ editor, groupId, onClose }) => {
  const { activeAIProvider, activeAIModel } = useAgentStore();
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<{ startOffset: number; endOffset: number; selectedText: string | null } | null>(null);

  useEffect(() => {
    const model = editor.getModel();
    const selection = editor.getSelection();
    const cursorPos = editor.getPosition();
    if (!model || !cursorPos) {
      onClose();
      return;
    }
    const hasSelection = !!selection && !selection.isEmpty();
    const startOffset = model.getOffsetAt(hasSelection ? selection.getStartPosition() : cursorPos);
    const endOffset = hasSelection ? model.getOffsetAt(selection.getEndPosition()) : startOffset;
    targetRef.current = { startOffset, endOffset, selectedText: hasSelection ? model.getValueInRange(selection) : null };

    const anchorPos = hasSelection ? selection.getStartPosition() : cursorPos;
    const reposition = () => {
      const coords = editor.getScrolledVisiblePosition(anchorPos);
      if (coords) setPosition({ top: coords.top + coords.height + 4, left: coords.left });
    };
    reposition();
    const disposable = editor.onDidScrollChange(reposition);
    return () => disposable.dispose();
  }, []);

  // Must focus in a separate effect keyed on `position`: the textarea/inputRef don't exist yet on the first render pass.
  useEffect(() => {
    if (position) inputRef.current?.focus();
  }, [position]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleSubmit = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || !targetRef.current || status === 'loading') return;
    const api = window.api;
    if (!api) return;
    const model = editor.getModel();
    if (!model) {
      onClose();
      return;
    }

    const fileContent = model.getValue();
    const languageId = model.getLanguageId();
    const { startOffset, endOffset, selectedText } = targetRef.current;

    setStatus('loading');
    setErrorMessage('');

    let accumulated = '';
    let hadError = false;
    const sessionId = crypto.randomUUID();
    const removeChunk = api.onAIChunk((chunkSessionId: string, chunk: string) => {
      if (chunkSessionId === sessionId) accumulated += chunk;
    });
    const removeErr = api.onAIErr((errSessionId: string, err: string) => {
      if (errSessionId !== sessionId) return;
      hadError = true;
      setStatus('error');
      setErrorMessage(err);
    });

    const prompt = buildInlineChatPrompt({ fileContent, languageId, instruction: trimmed, selectedText, cursorOffset: startOffset });

    try {
      await api.queryAI(activeAIProvider, activeAIModel, prompt, { sessionId });
    } catch (err: any) {
      hadError = true;
      setStatus('error');
      setErrorMessage(err?.message || 'Failed to generate edit.');
    } finally {
      removeChunk();
      removeErr();
    }

    if (hadError) return;

    const replacement = extractCodeBlock(accumulated).trim();
    if (!replacement) {
      setStatus('error');
      setErrorMessage('The AI returned an empty response.');
      return;
    }

    const newContent = applyInlineChatEdit(fileContent, startOffset, endOffset, replacement);

    // Re-read fresh rather than trusting a captured value — the user may have switched tabs while the request was in flight.
    const freshGroup = useWorkspaceStore.getState().groups.find((g) => g.id === groupId);
    const freshActiveTab = freshGroup?.tabs.find((t) => t.path === freshGroup.activeTabPath);
    if (!freshActiveTab) {
      onClose();
      return;
    }

    useWorkspaceStore.getState().updateTabContent(freshActiveTab.path, newContent, groupId);
    useAgentStore.getState().setPendingAIEdits({
      filePath: freshActiveTab.path,
      originalContent: fileContent,
      currentContent: newContent,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!position) return null;

  return (
    <div ref={wrapperRef} className="sde-inline-chat" style={{ top: position.top, left: position.left }}>
      <div className="sde-inline-chat-row">
        <Sparkles size={14} className="sde-inline-chat-icon" />
        <textarea
          ref={inputRef}
          className="sde-inline-chat-input"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={targetRef.current?.selectedText !== null ? 'Describe the edit…' : 'Describe what to insert…'}
          rows={1}
          disabled={status === 'loading'}
        />
        {status === 'loading' && <Loader2 size={14} className="sde-inline-chat-spinner" />}
      </div>
      {status === 'error' && <div className="sde-inline-chat-error">{errorMessage}</div>}
      <div className="sde-inline-chat-hint">
        <kbd>Enter</kbd> submit <kbd>Esc</kbd> cancel
      </div>
    </div>
  );
};
