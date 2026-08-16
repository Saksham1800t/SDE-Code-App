import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, Check } from 'lucide-react';
import { usePopoverPosition } from '../../common/usePopoverPosition';
import { useExtensionsStore } from '../../../store/extensions';
import { PROVIDER_LABEL } from '../../../utils/aiModels';

interface ModelSelectorProps {
  activeAIProvider: string;
  activeAIModel: string;
  setActiveAIProvider: (p: string) => void;
  setActiveAIModel: (m: string) => void;
  getModelsForProvider: (provider: string) => string[];
  customModelName: string;
  setCustomModelName: (name: string) => void;
}

const PROVIDER_ORDER = ['gemini', 'openai', 'anthropic', 'ollama', 'lm-studio', 'custom-openai'];

/** Merged provider+model picker: 2-level popover (pick provider, then model), using the shared popover positioning mechanics. */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  activeAIProvider,
  activeAIModel,
  setActiveAIProvider,
  setActiveAIModel,
  getModelsForProvider,
  customModelName,
  setCustomModelName,
}) => {
  const { extensions } = useExtensionsStore();
  const isGeminiEnabled = extensions.find((e) => e.id === 'sys.gemini')?.isEnabled !== false;
  const isOpenAIEnabled = extensions.find((e) => e.id === 'sys.openai')?.isEnabled !== false;
  const isClaudeEnabled = extensions.find((e) => e.id === 'sys.claude')?.isEnabled !== false;

  const enabledProviders = PROVIDER_ORDER.filter((p) => {
    if (p === 'gemini') return isGeminiEnabled;
    if (p === 'openai') return isOpenAIEnabled;
    if (p === 'anthropic') return isClaudeEnabled;
    return true;
  });

  const { open, setOpen, triggerRef, menuRef, menuPos, toggleOpen } = usePopoverPosition({
    estimatedHeight: 260,
    menuWidth: 200,
  });
  const [level, setLevel] = useState<'provider' | 'model'>('provider');

  const hasPresetModels = ['gemini', 'openai', 'anthropic'].includes(activeAIProvider);
  const modelLabel = hasPresetModels ? activeAIModel : (customModelName || activeAIModel);

  const handleOpen = () => {
    setLevel('provider');
    toggleOpen();
  };

  const handlePickProvider = (provider: string) => {
    setActiveAIProvider(provider);
    const presets = getModelsForProvider(provider);
    if (presets.length > 0) {
      setActiveAIModel(presets[0]);
    } else {
      setActiveAIModel(provider === 'ollama' ? 'llama3' : provider === 'lm-studio' ? 'local-model' : 'gpt-4o');
    }
    setLevel('model');
  };

  return (
    <div className="sde-model-selector">
      <button ref={triggerRef} className="sde-model-selector-trigger" onClick={handleOpen}>
        <span className="sde-model-selector-provider">{PROVIDER_LABEL[activeAIProvider] || activeAIProvider}</span>
        <span className="sde-model-selector-sep">·</span>
        <span className="sde-model-selector-model">{modelLabel}</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && createPortal(
        <div ref={menuRef} className="sde-popover-menu sde-model-selector-popover" style={{ top: menuPos.top, left: menuPos.left }}>
          {level === 'provider' ? (
            enabledProviders.map((p) => (
              <button
                key={p}
                className={`sde-popover-item${p === activeAIProvider ? ' active' : ''}`}
                onClick={() => handlePickProvider(p)}
              >
                {PROVIDER_LABEL[p]}
                {p === activeAIProvider && <Check size={12} className="sde-popover-check" />}
              </button>
            ))
          ) : (
            <>
              <button className="sde-popover-item sde-popover-item--back" onClick={() => setLevel('provider')}>
                <ChevronLeft size={12} /> {PROVIDER_LABEL[activeAIProvider]}
              </button>
              <div className="sde-popover-divider" />
              {hasPresetModels ? (
                getModelsForProvider(activeAIProvider).map((m) => (
                  <button
                    key={m}
                    className={`sde-popover-item${m === activeAIModel ? ' active' : ''}`}
                    onClick={() => { setActiveAIModel(m); setOpen(false); }}
                  >
                    {m}
                    {m === activeAIModel && <Check size={12} className="sde-popover-check" />}
                  </button>
                ))
              ) : (
                <div className="sde-model-selector-custom-input">
                  <input
                    type="text"
                    placeholder="Model ID..."
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    onBlur={() => setActiveAIModel(customModelName || 'local-model')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setActiveAIModel(customModelName || 'local-model');
                        setOpen(false);
                      }
                    }}
                    autoFocus
                  />
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};
