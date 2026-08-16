import React from 'react';
import './CommandPalette.css';

interface Command {
  id: string;
  name: string;
  category: string;
  description?: string;
}

interface Keybinding {
  command_id: string;
  key_combination: string;
}

interface CommandItemProps {
  cmd: Command;
  isSelected: boolean;
  kb?: Keybinding;
  onClick: () => void;
  onMouseEnter: () => void;
}

export const CommandItem: React.FC<CommandItemProps> = ({
  cmd,
  isSelected,
  kb,
  onClick,
  onMouseEnter,
}) => {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`sde-palette-item${isSelected ? ' active' : ''}`}
    >
      <div className="sde-flex-col" style={{ gap: '2px' }}>
        <div className="sde-flex-row" style={{ gap: '8px' }}>
          <span className="sde-palette-item-category">
            {cmd.category}
          </span>
          <span className="sde-palette-item-name">
            {cmd.name}
          </span>
        </div>
        {cmd.description && (
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {cmd.description}
          </span>
        )}
      </div>

      {kb && kb.key_combination && (
        <span className="sde-palette-item-kb">
          {kb.key_combination}
        </span>
      )}
    </div>
  );
};
