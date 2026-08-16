import React, { useCallback, useEffect, useRef, useState } from 'react';
import './TaskPickerDialog.css';
import { useTasksStore, type TaskDefinition } from '../../../store/tasks';
import { Play } from 'lucide-react';

interface TaskPickerDialogProps {
  onClose: () => void;
}

export const TaskPickerDialog: React.FC<TaskPickerDialogProps> = ({ onClose }) => {
  const { tasks, runTask } = useTasksStore();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = tasks.filter((t) => {
    const q = query.toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.command.toLowerCase().includes(q);
  });

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleSelect = useCallback(
    (task: TaskDefinition) => {
      runTask(task);
      onClose();
    },
    [runTask, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && filtered[activeIdx]) {
        handleSelect(filtered[activeIdx]);
      }
    },
    [filtered, activeIdx, handleSelect, onClose],
  );

  return (
    <>
      <div onClick={onClose} className="sde-taskpicker-backdrop" />

      <div className="sde-taskpicker-dialog">
        <div className="sde-taskpicker-search-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Run Task..."
            autoFocus
            className="sde-taskpicker-search-input"
          />
        </div>

        <div ref={listRef} className="sde-taskpicker-list">
          {filtered.length === 0 ? (
            <div className="sde-taskpicker-empty">No tasks match "{query}"</div>
          ) : (
            filtered.map((task, i) => {
              const isActive = i === activeIdx;
              return (
                <div
                  key={task.id}
                  onClick={() => handleSelect(task)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`sde-taskpicker-item${isActive ? ' active' : ''}`}
                >
                  <Play size={12} className="sde-taskpicker-item-icon" />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div className="sde-taskpicker-item-name">{task.name}</div>
                    <div className="sde-taskpicker-item-command">{task.command}</div>
                  </div>
                  {task.source && <span className="sde-taskpicker-item-source">{task.source}</span>}
                </div>
              );
            })
          )}
        </div>

        <div className="sde-taskpicker-footer">
          {[
            ['↑↓', 'navigate'],
            ['↵', 'run'],
            ['Esc', 'close'],
          ].map(([key, label]) => (
            <span key={key} className="sde-taskpicker-footer-item">
              <kbd className="sde-taskpicker-kbd">{key}</kbd>
              {label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>
            {filtered.length} of {tasks.length} tasks
          </span>
        </div>
      </div>
    </>
  );
};
