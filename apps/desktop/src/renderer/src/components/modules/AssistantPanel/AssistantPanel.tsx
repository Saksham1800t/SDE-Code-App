import React, { useState, useEffect, useRef } from 'react';
import './AssistantPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useAgentStore } from '../../../store/agent';
import { usePanelLayoutStore } from '../../../store/panelLayout';
import { MessageItem, Message } from './MessageItem';
import { ChatHistory } from './ChatHistory';
import { groupMessages } from './messageGrouping';
import { ToolRunGroup } from './ToolRunGroup';
import { InputArea, AssistantMode } from './InputArea';
import { MemoryPanel } from './MemoryPanel';
import { AgentWorkingSetPanel } from './AgentWorkingSetPanel';
import { extractCodeBlock } from './utils';
import { getModelsForProvider } from '../../../utils/aiModels';
import { markAIStreamStart, markAIStreamEnd } from '../../../utils/aiStreamLock';
import { notify } from '../../../store/notifications';
import { Sparkles, Brain, MessageSquare, Bot, Plus, X } from 'lucide-react';

interface SavedConversation {
  id: string;
  project_id: string;
  title: string;
  messages: string;
  updated_at: number;
}

export const AssistantPanel: React.FC = () => {
  const {
    workspaceName,
    workspacePath,
    openTabs,
    activeTabPath,
    updateTabContent,
  } = useWorkspaceStore();
  const {
    activeAIProvider,
    setActiveAIProvider,
    activeAIModel,
    setActiveAIModel,
    setPendingAIEdits,
    setAgentWorkingSet,
  } = useAgentStore();

  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const activeFileName = activeTab ? activeTab.name : null;

  // UI States
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [customModelName, setCustomModelName] = useState('');
  const [view, setView] = useState<'chat' | 'memory'>('chat');

  // Refs
  const messageEndRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<Message[]>([]);
  // Stable for this panel's whole lifetime — scopes every queryAI/queryAgent/abortAI call so this panel's stream never cross-cancels or interleaves with a concurrent one (e.g. a Parallel Agent Thread) sharing the same main process. See AiQueryOptions.sessionId's doc comment.
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  // Unlike sessionIdRef, this is assigned by the main process (externalAgent:run's return value), not generated client-side — null whenever no External Agent run is in flight.
  const externalAgentRunIdRef = useRef<string | null>(null);
  const [selectedExternalAgentId, setSelectedExternalAgentId] = useState<string | null>(null);

  // Load past conversations on mount or workspace change
  useEffect(() => {
    loadChatHistory();
  }, [workspaceName]);

  // Auto-sync customModelName state with activeAIModel for text-input providers
  useEffect(() => {
    if (['ollama', 'lm-studio', 'custom-openai'].includes(activeAIProvider)) {
      setCustomModelName(activeAIModel);
    }
  }, [activeAIProvider, activeAIModel]);

  const loadChatHistory = async () => {
    const api = window.api;
    if (!api || !workspaceName) return;
    try {
      const chats = await api.getConversations(workspaceName);
      setConversations(chats || []);
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  };

  const handleStartNewChat = () => {
    // Abort first, else the old chat's in-flight stream listeners keep appending tokens after the switch.
    if (isGenerating) handleAbort();
    setMessages([]);
    setActiveChatId(null);
  };

  const handleLoadChat = (chatId: string) => {
    const chat = conversations.find((c) => c.id === chatId);
    if (!chat) return;
    if (isGenerating) handleAbort();
    try {
      const loadedMessages = JSON.parse(chat.messages);
      setMessages(loadedMessages);
      setActiveChatId(chatId);
    } catch (e) {
      console.error('Failed to parse chat messages:', e);
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    const api = window.api;
    if (!api) return;
    try {
      await api.deleteConversation(chatId);
      if (activeChatId === chatId) {
        handleStartNewChat();
      }
      loadChatHistory();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  };

  const handleSendPrompt = async () => {
    if (!inputValue.trim() || isGenerating) return;

    const api = window.api;
    if (!api) {
      notify.error('Bridge API is not available.');
      return;
    }

    setIsGenerating(true);

    const userPrompt = inputValue.trim();
    setInputValue('');

    let finalPrompt = userPrompt;
    if (mode === 'edit') {
      if (!activeTab || activeTab.isSettings || activeTab.isDiff) {
        notify.error('Please select a valid open file to edit.');
        setIsGenerating(false);
        return;
      }
      finalPrompt = `You are tasked with modifying the active code file based on the following user instructions.
Instructions: ${userPrompt}

Please output the FULL, updated contents of the file. Surround the code block with markdown code blocks (e.g. \`\`\`js or \`\`\`typescript). Do not include any explanations or chatter before or after the code block. Just return the code block itself.`;
    }

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userPrompt, timestamp: Date.now() }
    ];
    setMessages(newMessages);

    // Add empty placeholder assistant message for streaming
    setMessages((prev) => [...prev, { role: 'assistant', content: '', isStreaming: true, timestamp: Date.now() }]);

    let accumulatedResponse = '';

    const removeChunkListener = api.onAIChunk((sessionId: string, chunk: string) => {
      if (sessionId !== sessionIdRef.current) return;
      accumulatedResponse += chunk;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = accumulatedResponse;
        }
        return next;
      });
    });

    const removeErrListener = api.onAIErr((sessionId: string, err: string) => {
      if (sessionId !== sessionIdRef.current) return;
      notify.error(err);
      setIsGenerating(false);
      setMessages((prev) => prev.filter((m) => !m.isStreaming || m.content !== ''));
    });

    try {
      markAIStreamStart();
      await api.queryAI(activeAIProvider, activeAIModel, finalPrompt, {
        activeFilePath: activeTabPath || undefined,
        projectId: workspaceName || undefined,
        sessionId: sessionIdRef.current,
      });

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          delete last.isStreaming;
        }
        return next;
      });

      setIsGenerating(false);

      // Handle Edit Code application
      if (mode === 'edit' && activeTab && activeTabPath) {
        const extractedCode = extractCodeBlock(accumulatedResponse);
        if (extractedCode && extractedCode.trim() !== '') {
          const originalContent = activeTab.content;

          updateTabContent(activeTabPath, extractedCode);

          // Store pre-edit changes in store for Accept/Reject review
          setPendingAIEdits({
            filePath: activeTabPath,
            originalContent,
            currentContent: extractedCode
          });
        }
      }

      if (workspaceName) {
        const chatId = activeChatId || 'chat_' + Math.random().toString(36).substring(2, 11);
        const title = activeChatId
          ? conversations.find((c) => c.id === activeChatId)?.title || userPrompt.slice(0, 30)
          : userPrompt.slice(0, 30) + '...';

        const updatedMessagesList = [
          ...newMessages,
          { role: 'assistant', content: accumulatedResponse }
        ];

        await api.saveConversation(chatId, workspaceName, title, JSON.stringify(updatedMessagesList));
        setActiveChatId(chatId);
        loadChatHistory();
      }

    } catch (err: any) {
      console.error(err);
      notify.error(err.message || 'AI request failed.');
      setIsGenerating(false);
    } finally {
      removeChunkListener();
      removeErrListener();
      markAIStreamEnd();
    }
  };

  const handleSendAgentPrompt = async () => {
    if (!inputValue.trim() || isGenerating) {
      return;
    }

    const api = window.api;
    if (!api) {
      notify.error('Bridge API is not available.');
      return;
    }
    if (!workspacePath) {
      notify.error(mode === 'repo' ? 'Open a folder to use Ask Repository.' : 'Open a folder to use Agent Mode.');
      return;
    }

    setIsGenerating(true);

    const userPrompt = inputValue.trim();
    setInputValue('');

    transcriptRef.current = [...messages, { role: 'user', content: userPrompt, timestamp: Date.now() }];
    setMessages([...transcriptRef.current]);

    const appendMessage = (msg: Message) => {
      transcriptRef.current.push({ ...msg, timestamp: msg.timestamp ?? Date.now() });
      setMessages([...transcriptRef.current]);
    };

    const removeChunkListener = api.onAgentChunk((sessionId: string, chunk: string) => {
      if (sessionId !== sessionIdRef.current) return;
      const last = transcriptRef.current[transcriptRef.current.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.content += chunk;
        setMessages([...transcriptRef.current]);
      } else {
        appendMessage({ role: 'assistant', content: chunk, isStreaming: true });
      }
    });

    const removeToolCallListener = api.onAgentToolCall((sessionId: string, info: { toolName: string; argsSummary: string; resultSummary: string }) => {
      if (sessionId !== sessionIdRef.current) return;
      const last = transcriptRef.current[transcriptRef.current.length - 1];
      if (last && last.role === 'assistant') {
        delete last.isStreaming;
      }
      appendMessage({ role: 'tool-progress', content: `${info.toolName}(${info.argsSummary})` });
    });

    const removeWorkingSetListener = api.onAgentWorkingSetUpdate((sessionId: string, changes: any[]) => {
      if (sessionId !== sessionIdRef.current) return;
      setAgentWorkingSet(changes);
    });

    const removeApprovalListener = api.onAgentApprovalRequest((sessionId: string, request: { requestId: string; toolName: string; argsSummary: string }) => {
      if (sessionId !== sessionIdRef.current) return;
      const last = transcriptRef.current[transcriptRef.current.length - 1];
      if (last && last.role === 'assistant') {
        delete last.isStreaming;
      }
      appendMessage({ role: 'approval-request', content: '', approval: { requestId: request.requestId, toolName: request.toolName, argsSummary: request.argsSummary } });
    });

    const removeErrListener = api.onAgentErr((sessionId: string, err: string) => {
      if (sessionId !== sessionIdRef.current) return;
      notify.error(err);
    });

    const removeDoneListener = api.onAgentDone((sessionId: string) => {
      if (sessionId !== sessionIdRef.current) return;
      const last = transcriptRef.current[transcriptRef.current.length - 1];
      if (last && last.role === 'assistant') {
        delete last.isStreaming;
        setMessages([...transcriptRef.current]);
      }
    });

    try {
      await api.queryAgent(activeAIProvider, activeAIModel, userPrompt, {
        activeFilePath: activeTabPath || undefined,
        projectId: workspaceName || undefined,
        workspacePath: workspacePath || undefined,
        workspaceFolders: useWorkspaceStore.getState().workspaceFolders.map((f) => f.path),
        mode: mode === 'repo' ? 'repo' : 'agent',
        sessionId: sessionIdRef.current,
      });

      setIsGenerating(false);

      if (workspaceName) {
        const chatId = activeChatId || 'chat_' + Math.random().toString(36).substring(2, 11);
        const title = activeChatId
          ? conversations.find((c) => c.id === activeChatId)?.title || userPrompt.slice(0, 30)
          : userPrompt.slice(0, 30) + '...';

        await api.saveConversation(chatId, workspaceName, title, JSON.stringify(transcriptRef.current));
        setActiveChatId(chatId);
        loadChatHistory();
      }
    } catch (err: any) {
      console.error(err);
      notify.error(err.message || 'Agent request failed.');
      setIsGenerating(false);
    } finally {
      removeChunkListener();
      removeToolCallListener();
      removeWorkingSetListener();
      removeApprovalListener();
      removeErrListener();
      removeDoneListener();
    }
  };

  // External Agent mode: spawns a fully autonomous external CLI tool (Aider, the Claude Code
  // CLI, ...) and streams its raw stdout/stderr in read-only — no tool-call parsing, no
  // approval prompts, no file-review staging, since the external tool manages its own
  // reasoning and file edits entirely on its own. See externalAgentService.ts's doc comment
  // for why this deliberately doesn't go through AiService's tool-calling loop.
  const handleSendExternalAgentPrompt = async () => {
    if (!inputValue.trim() || isGenerating) return;

    const api = window.api;
    if (!api) {
      notify.error('Bridge API is not available.');
      return;
    }
    if (!workspacePath) {
      notify.error('Open a folder to use an External Agent.');
      return;
    }
    if (!selectedExternalAgentId) {
      notify.error('Configure an external agent first (Settings > External Agents).');
      return;
    }

    setIsGenerating(true);

    const userPrompt = inputValue.trim();
    setInputValue('');

    transcriptRef.current = [...messages, { role: 'user', content: userPrompt, timestamp: Date.now() }];
    transcriptRef.current.push({ role: 'assistant', content: '', isStreaming: true, timestamp: Date.now() });
    setMessages([...transcriptRef.current]);

    let removeChunkListener: (() => void) | undefined;
    let removeDoneListener: (() => void) | undefined;
    let removeErrListener: (() => void) | undefined;

    try {
      const { runId } = await api.runExternalAgent(selectedExternalAgentId, userPrompt, workspacePath);
      externalAgentRunIdRef.current = runId;

      await new Promise<void>((resolve, reject) => {
        removeChunkListener = api.onExternalAgentChunk((rid, text) => {
          if (rid !== runId) return;
          const last = transcriptRef.current[transcriptRef.current.length - 1];
          if (last && last.role === 'assistant') {
            last.content += text;
            setMessages([...transcriptRef.current]);
          }
        });
        removeDoneListener = api.onExternalAgentDone((rid, exitCode) => {
          if (rid !== runId) return;
          const last = transcriptRef.current[transcriptRef.current.length - 1];
          if (last && last.role === 'assistant') {
            delete last.isStreaming;
            if (exitCode !== 0) last.content += `\n\n[process exited with code ${exitCode ?? '(unknown)'}]`;
            setMessages([...transcriptRef.current]);
          }
          resolve();
        });
        removeErrListener = api.onExternalAgentError((rid, message) => {
          if (rid !== runId) return;
          reject(new Error(message));
        });
      });

      if (workspaceName) {
        const chatId = activeChatId || 'chat_' + Math.random().toString(36).substring(2, 11);
        const title = activeChatId
          ? conversations.find((c) => c.id === activeChatId)?.title || userPrompt.slice(0, 30)
          : userPrompt.slice(0, 30) + '...';
        await api.saveConversation(chatId, workspaceName, title, JSON.stringify(transcriptRef.current));
        setActiveChatId(chatId);
        loadChatHistory();
      }
    } catch (err: any) {
      console.error(err);
      notify.error(err.message || 'External agent run failed.');
    } finally {
      removeChunkListener?.();
      removeDoneListener?.();
      removeErrListener?.();
      externalAgentRunIdRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleApprovalResponse = (requestId: string, approved: boolean) => {
    const api = window.api;
    if (api?.respondAgentApproval) {
      api.respondAgentApproval(requestId, approved);
    }

    const markResolved = (list: Message[]) =>
      list.map((m) =>
        m.role === 'approval-request' && m.approval?.requestId === requestId
          ? { ...m, approval: { ...m.approval, resolved: approved ? ('approved' as const) : ('denied' as const) } }
          : m,
      );

    transcriptRef.current = markResolved(transcriptRef.current);
    setMessages((prev) => markResolved(prev));
  };

  const handleInsertToEditor = (content: string) => {
    const { activeEditorInstance } = useWorkspaceStore.getState();
    if (activeEditorInstance) {
      activeEditorInstance.focus();
      activeEditorInstance.trigger('keyboard', 'type', { text: content });
    }
  };

  const handleAbort = () => {
    const api = window.api;
    if (api && api.abortAI) {
      api.abortAI(sessionIdRef.current);
    }
    if (api?.cancelExternalAgentRun && externalAgentRunIdRef.current) {
      api.cancelExternalAgentRun(externalAgentRunIdRef.current);
      externalAgentRunIdRef.current = null;
    }
    setIsGenerating(false);

    const denyUnresolvedApprovals = (list: Message[]) =>
      list.map((m) =>
        m.role === 'approval-request' && m.approval && !m.approval.resolved
          ? { ...m, approval: { ...m.approval, resolved: 'denied' as const } }
          : m,
      );
    transcriptRef.current = denyUnresolvedApprovals(transcriptRef.current);

    setMessages((prev) => {
      const next = denyUnresolvedApprovals(prev);
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        delete last.isStreaming;
        if (!last.content) {
          return next.slice(0, -1);
        }
      }
      return next;
    });
  };

  return (
    <div className="sde-assistant-panel">
      {/* AI Controls Header */}
      <div className="sde-assistant-header">
        <div className="sde-assistant-header-row">
          <span className="sde-assistant-title">
            <Sparkles size={12} /> <span className="sde-header-btn-label">SDE ASSISTANT</span>
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            {view === 'chat' && (
              <ChatHistory
                conversations={conversations}
                activeChatId={activeChatId}
                handleLoadChat={handleLoadChat}
                handleDeleteChat={handleDeleteChat}
              />
            )}
            <button
              className="sde-header-icon-btn"
              onClick={() => setView(view === 'chat' ? 'memory' : 'chat')}
              title={view === 'chat' ? 'Project rules & memory the AI uses for this workspace' : 'Back to chat'}
            >
              {view === 'chat' ? <Brain size={13} /> : <MessageSquare size={13} />}
            </button>
            {view === 'chat' && (
              <button className="sde-header-icon-btn" onClick={handleStartNewChat} title="New Chat">
                <Plus size={13} />
              </button>
            )}
            <button
              className="sde-header-icon-btn"
              onClick={() => usePanelLayoutStore.getState().toggleRightSidebar(false)}
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      {view === 'memory' ? (
        <MemoryPanel />
      ) : (
        <>
          {/* Messages Scroll Area */}
          <div className="sde-assistant-messages">
            {messages.length === 0 && (
              <div className="sde-assistant-empty">
                <div className="sde-assistant-empty-icon"><Bot size={28} /></div>
                <h4>How can SDE AI help you?</h4>
                <p>
                  Ask a question, switch to <strong>Edit</strong> mode to modify the active file directly, <strong>Agent</strong> mode to complete a multi-file task, or <strong>Repo</strong> mode to ask about this workspace's git history.
                </p>
              </div>
            )}

            {groupMessages(messages).map((item, idx, arr) =>
              item.type === 'tool-run' ? (
                <ToolRunGroup
                  key={item.key}
                  items={item.items}
                  startedAt={item.startedAt}
                  endedAt={item.endedAt}
                  isLive={item.endedAt === null && isGenerating && idx === arr.length - 1}
                />
              ) : (
                <MessageItem key={item.key} msg={item.msg} onApprovalResponse={handleApprovalResponse} onInsertToEditor={handleInsertToEditor} />
              )
            )}

            <div ref={messageEndRef} />
          </div>

          <AgentWorkingSetPanel />

          {/* Input controls panel */}
          <InputArea
            activeFileName={activeFileName}
            mode={mode}
            setMode={setMode}
            inputValue={inputValue}
            setInputValue={setInputValue}
            isGenerating={isGenerating}
            handleSendPrompt={
              mode === 'agent' || mode === 'repo' ? handleSendAgentPrompt
                : mode === 'external' ? handleSendExternalAgentPrompt
                : handleSendPrompt
            }
            handleAbort={handleAbort}
            activeAIProvider={activeAIProvider}
            activeAIModel={activeAIModel}
            setActiveAIProvider={setActiveAIProvider}
            setActiveAIModel={setActiveAIModel}
            getModelsForProvider={getModelsForProvider}
            customModelName={customModelName}
            setCustomModelName={setCustomModelName}
            selectedExternalAgentId={selectedExternalAgentId}
            setSelectedExternalAgentId={setSelectedExternalAgentId}
          />
        </>
      )}
    </div>
  );
};
