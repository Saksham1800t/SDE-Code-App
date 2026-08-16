import React from 'react';
import './TerminalAutocompleteDropdown.css';

interface TerminalAutocompleteDropdownProps {
  suggestions: string[];
  highlightIndex: number;
  position: { top: number; left: number };
  onSelect: (index: number) => void;
}

/** Purely presentational floating suggestion list (fixed pixel position, not a real xterm widget); TerminalArea.tsx owns all keyboard/accept logic. */
export const TerminalAutocompleteDropdown: React.FC<TerminalAutocompleteDropdownProps> = ({
  suggestions,
  highlightIndex,
  position,
  onSelect,
}) => {
  return (
    <div className="sde-terminal-autocomplete" style={{ top: position.top, left: position.left }}>
      {suggestions.map((s, i) => (
        <div
          key={s}
          className={`sde-terminal-autocomplete-item${i === highlightIndex ? ' active' : ''}`}
          onMouseDown={(e) => {
            // mousedown (not click) so this fires before the terminal
            // regains focus and the click event would otherwise be lost to it.
            e.preventDefault();
            onSelect(i);
          }}
        >
          {s}
        </div>
      ))}
    </div>
  );
};
