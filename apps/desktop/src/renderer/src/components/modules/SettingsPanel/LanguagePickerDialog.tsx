import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loader } from '@monaco-editor/react';
import './LanguagePickerDialog.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { X } from 'lucide-react';

interface LanguagePickerDialogProps {
  onClose: () => void;
  onLanguageConfigured: (languageId: string) => void;
}

interface LanguageEntry {
  id: string;
  label: string;
}

function fuzzyMatch(query: string, str: string): { matched: boolean; score: number; ranges: [number, number][] } {
  if (!query) return { matched: true, score: 0, ranges: [] };
  const ql = query.toLowerCase();
  const sl = str.toLowerCase();
  const ranges: [number, number][] = [];
  let qi = 0, score = 0;
  for (let si = 0; si < sl.length && qi < ql.length; si++) {
    if (sl[si] === ql[qi]) {
      ranges.push([si, si + 1]);
      score += si === 0 ? 10 : 1;
      qi++;
    }
  }
  return { matched: qi === ql.length, score, ranges };
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach(([start, end], i) => {
    if (start > last) parts.push(<span key={`pre-${i}`}>{text.slice(last, start)}</span>);
    parts.push(
      <mark key={`m-${i}`} className="sde-search-mark" style={{ padding: 0 }}>
        {text.slice(start, end)}
      </mark>,
    );
    last = end;
  });
  if (last < text.length) parts.push(<span key="post">{text.slice(last)}</span>);
  return <>{parts}</>;
}

export const LanguagePickerDialog: React.FC<LanguagePickerDialogProps> = ({ onClose, onLanguageConfigured }) => {
  const { openLanguageSnippetFile } = useWorkspaceStore();
  const [query, setQuery] = useState('');
  const [allLanguages, setAllLanguages] = useState<LanguageEntry[]>([]);
  const [filtered, setFiltered] = useState<{ id: string; label: string; ranges: [number, number][] }[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loader.init().then((monaco) => {
      const languages = monaco.languages
        .getLanguages()
        .map((l) => ({ id: l.id, label: l.aliases?.[0] ?? l.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setAllLanguages(languages);
      setLoading(false);
    }).catch(() => setLoading(false));
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const results = allLanguages
      .map((lang) => ({ ...lang, ...fuzzyMatch(query, lang.label) }))
      .filter((r) => r.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => ({ id: r.id, label: r.label, ranges: r.ranges }));
    setFiltered(results);
    setActiveIdx(0);
  }, [query, allLanguages]);

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleSelect = useCallback(async (languageId: string) => {
    await openLanguageSnippetFile(languageId);
    onLanguageConfigured(languageId);
    onClose();
  }, [openLanguageSnippetFile, onLanguageConfigured, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
      handleSelect(filtered[activeIdx].id);
    }
  }, [filtered, activeIdx, handleSelect, onClose]);

  return (
    <>
      <div onClick={onClose} className="sde-langpicker-backdrop" />

      <div className="sde-langpicker-dialog">
        <div className="sde-langpicker-search-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Select a Language..."
            autoFocus
            className="sde-langpicker-search-input"
          />
          {query && (
            <button onClick={() => setQuery('')} className="sde-tab-close-btn" style={{ padding: '4px' }}><X size={12} /></button>
          )}
        </div>

        <div ref={listRef} className="sde-langpicker-list">
          {loading ? (
            <div className="sde-langpicker-empty">Loading languages…</div>
          ) : filtered.length === 0 ? (
            <div className="sde-langpicker-empty">No languages match "{query}"</div>
          ) : filtered.map((item, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={item.id}
                onClick={() => handleSelect(item.id)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`sde-langpicker-item${isActive ? ' active' : ''}`}
              >
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div className="sde-langpicker-item-name">
                    <Highlighted text={item.label} ranges={item.ranges} />
                  </div>
                </div>
                {item.id !== item.label && (
                  <span className="sde-langpicker-item-id">{item.id}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="sde-langpicker-footer">
          {[['↑↓', 'navigate'], ['↵', 'select'], ['Esc', 'close']].map(([key, label]) => (
            <span key={key} className="sde-langpicker-footer-item">
              <kbd className="sde-langpicker-kbd">{key}</kbd>
              {label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>
            {filtered.length} of {allLanguages.length} languages
          </span>
        </div>
      </div>
    </>
  );
};
