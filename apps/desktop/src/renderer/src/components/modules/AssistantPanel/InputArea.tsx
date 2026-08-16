import React from 'react';
import { createPortal } from 'react-dom';
import './AssistantPanel.css';
import { TextArea } from '../../common/Input';
import { usePopoverPosition } from '../../common/usePopoverPosition';
import { ModelSelector } from './ModelSelector';
import { FileText, FolderOpen, MessageSquare, PencilLine, Bot, Search, Terminal, ChevronDown, Check, ArrowUp, Square } from 'lucide-react';
import { ExternalAgentSelector } from './ExternalAgentSelector';

export type AssistantMode = 'ask' | 'edit' | 'agent' | 'repo' | 'external';

interface InputAreaProps {
  activeFileName: string | null;
  mode: AssistantMode;
  setMode: (mode: AssistantMode) => void;
  inputValue: string;
  setInputValue: (val: string) => void;
  isGenerating: boolean;
  handleSendPrompt: () => void;
  handleAbort: () => void;
  activeAIProvider: string;
  activeAIModel: string;
  setActiveAIProvider: (p: string) => void;
  setActiveAIModel: (m: string) => void;
  getModelsForProvider: (provider: string) => string[];
  customModelName: string;
  setCustomModelName: (name: string) => void;
  selectedExternalAgentId: string | null;
  setSelectedExternalAgentId: (id: string | null) => void;
}

const MODE_PLACEHOLDER: Record<AssistantMode, string> = {
  ask: 'Ask a question...',
  edit: 'Describe how to modify the code...',
  agent: 'Describe a task for the agent to complete...',
  repo: 'Ask about this repository\'s history...',
  external: 'Describe a task for the external agent to complete...',
};

const MODE_ACCENT: Record<AssistantMode, 'cyan' | 'purple'> = {
  ask: 'cyan',
  edit: 'purple',
  agent: 'purple',
  repo: 'cyan',
  external: 'purple',
};

const MODE_LABEL: Record<AssistantMode, string> = {
  ask: 'Chat',
  edit: 'Edit',
  agent: 'Agent',
  repo: 'Repo',
  external: 'External',
};

const MODE_ICON: Record<AssistantMode, React.ReactNode> = {
  ask: <MessageSquare size={12} />,
  edit: <PencilLine size={12} />,
  agent: <Bot size={12} />,
  repo: <Search size={12} />,
  external: <Terminal size={12} />,
};

const MODE_ORDER: AssistantMode[] = ['ask', 'edit', 'agent', 'repo', 'external'];

const ModeDropdown: React.FC<{ mode: AssistantMode; setMode: (mode: AssistantMode) => void }> = ({ mode, setMode }) => {
  const { open, setOpen, triggerRef, menuRef, menuPos, toggleOpen } = usePopoverPosition({
    estimatedHeight: MODE_ORDER.length * 30 + 8,
  });

  return (
    <div className="sde-mode-dropdown">
      <button ref={triggerRef} className="sde-mode-dropdown-trigger" onClick={toggleOpen}>
        {MODE_ICON[mode]} {MODE_LABEL[mode]}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && createPortal(
        <div ref={menuRef} className="sde-popover-menu" style={{ top: menuPos.top, left: menuPos.left }}>
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              className={`sde-popover-item${m === mode ? ' active' : ''}`}
              onClick={() => { setMode(m); setOpen(false); }}
            >
              {MODE_ICON[m]} {MODE_LABEL[m]}
              {m === mode && <Check size={12} className="sde-popover-check" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

export const InputArea: React.FC<InputAreaProps> = ({
  activeFileName,
  mode,
  setMode,
  inputValue,
  setInputValue,
  isGenerating,
  handleSendPrompt,
  handleAbort,
  activeAIProvider,
  activeAIModel,
  setActiveAIProvider,
  setActiveAIModel,
  getModelsForProvider,
  customModelName,
  setCustomModelName,
  selectedExternalAgentId,
  setSelectedExternalAgentId,
}) => {
  return (
    <div className="sde-assistant-input-area">
      <div className={`sde-context-pill${activeFileName ? ' sde-context-pill--active' : ' sde-context-pill--inactive'}`}>
        {activeFileName ? (
          <>
            <span className="sde-context-pill-icon"><FileText size={11} /></span>
            <span className="sde-context-pill-text">Context: {activeFileName}</span>
          </>
        ) : (
          <>
            <span className="sde-context-pill-icon"><FolderOpen size={11} /></span>
            <span className="sde-context-pill-text">No Context File</span>
          </>
        )}
      </div>

      <div className="sde-assistant-input-card">
        <TextArea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendPrompt();
            }
          }}
          placeholder={MODE_PLACEHOLDER[mode]}
          rows={2}
          focusAccent={MODE_ACCENT[mode]}
          className="sde-input-card-textarea"
          style={{ background: 'transparent', color: 'var(--text-primary)', fontSize: '12px', fontFamily: 'var(--font-sans)' }}
        />

        <div className="sde-input-card-controls">
          <div className="sde-mode-segmented">
            {MODE_ORDER.map((m) => (
              <button key={m} className={`sde-mode-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                {MODE_ICON[m]} {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <ModeDropdown mode={mode} setMode={setMode} />

          {mode === 'external' ? (
            <ExternalAgentSelector
              selectedId={selectedExternalAgentId}
              setSelectedId={setSelectedExternalAgentId}
            />
          ) : (
            <ModelSelector
              activeAIProvider={activeAIProvider}
              activeAIModel={activeAIModel}
              setActiveAIProvider={setActiveAIProvider}
              setActiveAIModel={setActiveAIModel}
              getModelsForProvider={getModelsForProvider}
              customModelName={customModelName}
              setCustomModelName={setCustomModelName}
            />
          )}

          {isGenerating ? (
            <button className="sde-send-btn sde-send-btn--stop" onClick={handleAbort} title="Stop">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className="sde-send-btn"
              onClick={handleSendPrompt}
              disabled={!inputValue.trim()}
              title="Send"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
