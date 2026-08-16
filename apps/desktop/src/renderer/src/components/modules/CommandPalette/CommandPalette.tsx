import React, { useEffect, useState, useRef } from 'react';
import './CommandPalette.css';
import { useCommandsStore } from '../../../store/commands';
import { CommandItem } from './CommandItem';

export const CommandPalette: React.FC = () => {
  const {
    isPaletteOpen,
    setPaletteOpen,
    commands,
    keybindings,
    executeCommand,
    registerCommandCallback,
    recentCommandIds,
  } = useCommandsStore();

  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unregister = registerCommandCallback('workbench.action.showCommands', () => {
      setPaletteOpen(true);
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
    return unregister;
  }, [registerCommandCallback, setPaletteOpen]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        isPaletteOpen &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setPaletteOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isPaletteOpen, setPaletteOpen]);

  // Filter by search text, then reorder recently-used matches to the top (MRU order).
  const filteredCommands = commands
    .filter((cmd) => {
      const term = search.toLowerCase();
      return (
        cmd.name.toLowerCase().includes(term) ||
        cmd.category.toLowerCase().includes(term) ||
        (cmd.description && cmd.description.toLowerCase().includes(term))
      );
    })
    .sort((a, b) => {
      const ai = recentCommandIds.indexOf(a.id);
      const bi = recentCommandIds.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        setPaletteOpen(false);
        executeCommand(selected.id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPaletteOpen(false);
    }
  };

  if (!isPaletteOpen) return null;

  return (
    <div className="sde-palette-overlay">
      <div ref={containerRef} className="sde-palette-container">
        <div className="sde-palette-search-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command to execute..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="sde-palette-search-input"
          />
        </div>

        <div className="sde-palette-list">
          {filteredCommands.length === 0 ? (
            <div className="sde-palette-empty">
              No matching commands found.
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const isSelected = index === selectedIndex;
              const kb = keybindings.find((k) => k.command_id === cmd.id);
              
              return (
                <CommandItem
                  key={cmd.id}
                  cmd={cmd}
                  isSelected={isSelected}
                  kb={kb}
                  onClick={() => {
                    setPaletteOpen(false);
                    executeCommand(cmd.id);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
