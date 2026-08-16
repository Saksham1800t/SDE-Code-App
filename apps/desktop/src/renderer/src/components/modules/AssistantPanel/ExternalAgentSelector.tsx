import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { usePopoverPosition } from '../../common/usePopoverPosition';
import { useExternalAgentsStore } from '../../../store/externalAgents';

interface ExternalAgentSelectorProps {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

/** One-level cousin of ModelSelector — picks which configured external agent (Settings > External Agents) a send in "External" mode runs. */
export const ExternalAgentSelector: React.FC<ExternalAgentSelectorProps> = ({ selectedId, setSelectedId }) => {
  const { configs, loadConfigs } = useExternalAgentsStore();
  const { open, setOpen, triggerRef, menuRef, menuPos, toggleOpen } = usePopoverPosition({
    estimatedHeight: Math.min(configs.length, 6) * 30 + 8,
    menuWidth: 200,
  });

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // Default to the first configured agent once configs load, if nothing's selected yet.
  useEffect(() => {
    if (!selectedId && configs.length > 0) setSelectedId(configs[0].id);
  }, [configs, selectedId, setSelectedId]);

  const selected = configs.find((c) => c.id === selectedId);

  return (
    <div className="sde-model-selector">
      <button ref={triggerRef} className="sde-model-selector-trigger" onClick={toggleOpen} disabled={configs.length === 0}>
        <span className="sde-model-selector-provider">
          {configs.length === 0 ? 'No external agents configured' : selected?.name || 'Select agent'}
        </span>
        {configs.length > 0 && (
          <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        )}
      </button>

      {open && configs.length > 0 && createPortal(
        <div ref={menuRef} className="sde-popover-menu" style={{ top: menuPos.top, left: menuPos.left }}>
          {configs.map((c) => (
            <button
              key={c.id}
              className={`sde-popover-item${c.id === selectedId ? ' active' : ''}`}
              onClick={() => { setSelectedId(c.id); setOpen(false); }}
            >
              {c.name}
              {c.id === selectedId && <Check size={12} className="sde-popover-check" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};
