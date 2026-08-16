import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './QuickOpen.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { extractSymbols, type FileSymbol } from '../../../../../shared/extractSymbols';
import type { WorkspaceSymbolResult } from '@sde-code/protocol';
import { X } from 'lucide-react';

interface QuickOpenDialogProps {
  onClose: () => void;
  /** Pre-filled query — pass ':' to land directly in go-to-line mode (Ctrl+G). */
  initialQuery?: string;
}

/** VS Code's own `:line[:column]` go-to-line convention (gotoLineQuickAccess). */
const GOTO_LINE_PATTERN = /^:(\d+)(?::(\d+))?$/;
/** VS Code's own `@` go-to-symbol-in-file convention (symbolsQuickAccess). */
const SYMBOL_MODE_PREFIX = '@';
/** VS Code's own `#` go-to-symbol-in-workspace convention (symbolsQuickAccess). */
const WORKSPACE_SYMBOL_MODE_PREFIX = '#';

function fuzzyMatch(query: string, str: string): { matched: boolean; score: number; ranges: [number, number][] } {
  if (!query) return { matched: true, score: 0, ranges: [] };
  const ql = query.toLowerCase();
  const sl = str.toLowerCase();
  const ranges: [number, number][] = [];
  let qi = 0, score = 0;
  for (let si = 0; si < sl.length && qi < ql.length; si++) {
    if (sl[si] === ql[qi]) {
      ranges.push([si, si + 1]);
      score += si === 0 || str[si - 1] === '/' || str[si - 1] === '\\' ? 10 : 1;
      qi++;
    }
  }
  return { matched: qi === ql.length, score, ranges };
}

function HighlightedPath({ path, ranges }: { path: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach(([start, end], i) => {
    if (start > last) parts.push(<span key={`pre-${i}`}>{path.slice(last, start)}</span>);
    parts.push(
      <mark key={`m-${i}`} className="sde-search-mark" style={{ padding: 0 }}>
        {path.slice(start, end)}
      </mark>
    );
    last = end;
  });
  if (last < path.length) parts.push(<span key="post">{path.slice(last)}</span>);
  return <>{parts}</>;
}

/** One file in the flat go-to-file list — `relativePath` is display-only (folder-name-prefixed once there's more than one open folder); `absolutePath` is always the real path used to open it. */
interface QuickOpenFileEntry {
  relativePath: string;
  absolutePath: string;
}

export const QuickOpenDialog: React.FC<QuickOpenDialogProps> = ({ onClose, initialQuery = '' }) => {
  const { workspaceFolders, openFile, activeEditorInstance, activeTabPath } = useWorkspaceStore();
  const [query, setQuery] = useState(initialQuery);
  const goToLineMatch = query.match(GOTO_LINE_PATTERN);
  const isSymbolMode = query.startsWith(SYMBOL_MODE_PREFIX);
  const symbolQuery = isSymbolMode ? query.slice(1) : '';

  const fileSymbols = useMemo(() => {
    if (!isSymbolMode || !activeEditorInstance) return [];
    const model = activeEditorInstance.getModel();
    if (!model) return [];
    return extractSymbols(model.getValue(), model.getLanguageId());
  }, [isSymbolMode, activeEditorInstance]);

  const filteredSymbols = useMemo(() => {
    if (!isSymbolMode) return [];
    return fileSymbols
      .map((s) => ({ symbol: s, ...fuzzyMatch(symbolQuery, s.name) }))
      .filter((r) => r.matched)
      .sort((a, b) => b.score - a.score);
  }, [isSymbolMode, fileSymbols, symbolQuery]);

  const isWorkspaceSymbolMode = query.startsWith(WORKSPACE_SYMBOL_MODE_PREFIX);
  const workspaceSymbolQuery = isWorkspaceSymbolMode ? query.slice(1) : '';
  const [workspaceSymbols, setWorkspaceSymbols] = useState<WorkspaceSymbolResult[]>([]);
  const [workspaceSymbolsLoading, setWorkspaceSymbolsLoading] = useState(false);
  const workspaceSymbolsFetchedRef = useRef(false);

  // Lazy-fetch once, the first time # mode is entered — a full-workspace symbol scan is too expensive to redo per keystroke.
  useEffect(() => {
    if (!isWorkspaceSymbolMode || workspaceSymbolsFetchedRef.current || workspaceFolders.length === 0) return;
    workspaceSymbolsFetchedRef.current = true;
    setWorkspaceSymbolsLoading(true);
    const multiRoot = workspaceFolders.length > 1;
    Promise.all(workspaceFolders.map((f) => window.api.searchWorkspaceSymbols(f.path)))
      .then((perFolder: WorkspaceSymbolResult[][]) => {
        const merged = perFolder.flatMap((results, i) =>
          multiRoot ? results.map((r) => ({ ...r, relativePath: `${workspaceFolders[i].name}/${r.relativePath}` })) : results,
        );
        setWorkspaceSymbols(merged);
      })
      .catch(() => setWorkspaceSymbols([]))
      .finally(() => setWorkspaceSymbolsLoading(false));
  }, [isWorkspaceSymbolMode, workspaceFolders]);

  const filteredWorkspaceSymbols = useMemo(() => {
    if (!isWorkspaceSymbolMode) return [];
    return workspaceSymbols
      .map((s) => ({ symbol: s, ...fuzzyMatch(workspaceSymbolQuery, s.name) }))
      .filter((r) => r.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [isWorkspaceSymbolMode, workspaceSymbols, workspaceSymbolQuery]);

  const [allFiles, setAllFiles] = useState<QuickOpenFileEntry[]>([]);
  const [filtered, setFiltered] = useState<{ path: string; absolutePath: string; ranges: [number, number][] }[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load the file list on mount, fanning out across every open folder.
  useEffect(() => {
    if (workspaceFolders.length === 0) { setLoading(false); return; }
    (async () => {
      try {
        const api = window.api;
        const multiRoot = workspaceFolders.length > 1;
        const perFolder = await Promise.all(workspaceFolders.map((f) => api.listAllFiles(f.path)));
        const entries: QuickOpenFileEntry[] = perFolder.flatMap((files: string[], i) =>
          files.map((relPath) => ({
            relativePath: multiRoot ? `${workspaceFolders[i].name}/${relPath}` : relPath,
            absolutePath: `${workspaceFolders[i].path}/${relPath}`,
          })),
        );
        setAllFiles(entries);
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    })();
    inputRef.current?.focus();
  }, [workspaceFolders]);

  // Filter on query change
  useEffect(() => {
    if (!query.trim()) {
      setFiltered(allFiles.slice(0, 50).map(f => ({ path: f.relativePath, absolutePath: f.absolutePath, ranges: [] })));
      setActiveIdx(0);
      return;
    }
    const results = allFiles
      .map(f => {
        const name = f.relativePath.split('/').pop() || f.relativePath;
        const nameMatch = fuzzyMatch(query, name);
        const pathMatch = fuzzyMatch(query, f.relativePath);
        const best = nameMatch.matched ? nameMatch : pathMatch;
        return { path: f.relativePath, absolutePath: f.absolutePath, ...best };
      })
      .filter(r => r.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(r => ({ path: r.path, absolutePath: r.absolutePath, ranges: r.ranges }));
    setFiltered(results);
    setActiveIdx(0);
  }, [query, allFiles]);

  // Scroll active into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const jumpToLine = useCallback(() => {
    if (!goToLineMatch || !activeEditorInstance || !activeTabPath) { onClose(); return; }
    const lineNumber = Number(goToLineMatch[1]);
    const column = goToLineMatch[2] ? Number(goToLineMatch[2]) : 1;
    activeEditorInstance.setPosition({ lineNumber, column });
    activeEditorInstance.revealLineInCenter(lineNumber);
    activeEditorInstance.focus();
    onClose();
  }, [goToLineMatch, activeEditorInstance, activeTabPath, onClose]);

  const jumpToSymbol = useCallback((symbol: FileSymbol) => {
    if (!activeEditorInstance) { onClose(); return; }
    activeEditorInstance.setPosition({ lineNumber: symbol.line, column: 1 });
    activeEditorInstance.revealLineInCenter(symbol.line);
    activeEditorInstance.focus();
    onClose();
  }, [activeEditorInstance, onClose]);

  const jumpToWorkspaceSymbol = useCallback((symbol: WorkspaceSymbolResult) => {
    onClose();
    openFile(symbol.file, symbol.relativePath.split('/').pop() || symbol.relativePath);
    // openFile swaps the active tab's model asynchronously, so wait via a fixed delay since there's no completion event to await.
    setTimeout(() => {
      const editor = useWorkspaceStore.getState().activeEditorInstance;
      if (editor) {
        editor.setPosition({ lineNumber: symbol.line, column: 1 });
        editor.revealLineInCenter(symbol.line);
        editor.focus();
      }
    }, 200);
  }, [openFile, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (goToLineMatch) {
      if (e.key === 'Enter') { e.preventDefault(); jumpToLine(); }
      return;
    }
    if (isSymbolMode) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filteredSymbols.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && filteredSymbols[activeIdx]) { e.preventDefault(); jumpToSymbol(filteredSymbols[activeIdx].symbol); }
      return;
    }
    if (isWorkspaceSymbolMode) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filteredWorkspaceSymbols.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && filteredWorkspaceSymbols[activeIdx]) { e.preventDefault(); jumpToWorkspaceSymbol(filteredWorkspaceSymbols[activeIdx].symbol); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[activeIdx]) {
      const item = filtered[activeIdx];
      openFile(item.absolutePath, item.path.split('/').pop() || item.path);
      onClose();
    }
  }, [filtered, activeIdx, openFile, onClose, goToLineMatch, jumpToLine, isSymbolMode, filteredSymbols, jumpToSymbol, isWorkspaceSymbolMode, filteredWorkspaceSymbols, jumpToWorkspaceSymbol]);

  const handleSelect = (item: { path: string; absolutePath: string }) => {
    openFile(item.absolutePath, item.path.split('/').pop() || item.path);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="sde-quickopen-backdrop"
      />

      {/* Dialog */}
      <div className="sde-quickopen-dialog">
        {/* Input */}
        <div className="sde-quickopen-search-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to File... (: line, @ symbol in file, # symbol in workspace)"
            autoFocus
            className="sde-quickopen-search-input"
          />
          {query && (
            <button onClick={() => setQuery('')} className="sde-tab-close-btn" style={{ padding: '4px' }}><X size={12} /></button>
          )}
        </div>

        {/* Results list */}
        <div ref={listRef} className="sde-quickopen-list">
          {goToLineMatch ? (
            !activeEditorInstance || !activeTabPath ? (
              <div className="sde-quickopen-empty">Open a file first to jump to a line in it.</div>
            ) : (
              <div className="sde-quickopen-item active" onClick={jumpToLine}>
                <span className="sde-quickopen-item-name">
                  Go to line {goToLineMatch[1]}{goToLineMatch[2] ? `, column ${goToLineMatch[2]}` : ''}
                </span>
              </div>
            )
          ) : isSymbolMode ? (
            !activeEditorInstance || !activeTabPath ? (
              <div className="sde-quickopen-empty">Open a file first to search its symbols.</div>
            ) : fileSymbols.length === 0 ? (
              <div className="sde-quickopen-empty">No recognized symbols in this file (function/class/interface declarations only).</div>
            ) : filteredSymbols.length === 0 ? (
              <div className="sde-quickopen-empty">No symbols match "{symbolQuery}"</div>
            ) : filteredSymbols.map(({ symbol }, i) => (
              <div
                key={`${symbol.name}-${symbol.line}`}
                onClick={() => jumpToSymbol(symbol)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`sde-quickopen-item${i === activeIdx ? ' active' : ''}`}
              >
                <span className="sde-quickopen-item-name">{symbol.name}</span>
                <span className="sde-quickopen-item-dir">{symbol.kind} · line {symbol.line}</span>
              </div>
            ))
          ) : isWorkspaceSymbolMode ? (
            workspaceFolders.length === 0 ? (
              <div className="sde-quickopen-empty">Open a folder first to search its symbols.</div>
            ) : workspaceSymbolsLoading ? (
              <div className="sde-quickopen-empty">Scanning workspace for symbols…</div>
            ) : filteredWorkspaceSymbols.length === 0 ? (
              <div className="sde-quickopen-empty">No symbols match "{workspaceSymbolQuery}"</div>
            ) : filteredWorkspaceSymbols.map(({ symbol }, i) => (
              <div
                key={`${symbol.file}-${symbol.name}-${symbol.line}`}
                onClick={() => jumpToWorkspaceSymbol(symbol)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`sde-quickopen-item${i === activeIdx ? ' active' : ''}`}
              >
                <span className="sde-quickopen-item-name">{symbol.name}</span>
                <span className="sde-quickopen-item-dir">{symbol.kind} · {symbol.relativePath}:{symbol.line}</span>
              </div>
            ))
          ) : loading ? (
            <div className="sde-quickopen-empty">Indexing files…</div>
          ) : filtered.length === 0 ? (
            <div className="sde-quickopen-empty">No files match "{query}"</div>
          ) : filtered.map((item, i) => {
            const name = item.path.split('/').pop() || item.path;
            const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
            const isActive = i === activeIdx;
            const dirLen = dir.length + (dir ? 1 : 0);
            const nameRanges = item.ranges
              .filter(([s]) => s >= dirLen)
              .map(([s, e]) => [s - dirLen, e - dirLen] as [number, number]);
            return (
              <div
                key={item.path}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`sde-quickopen-item${isActive ? ' active' : ''}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isActive ? 'var(--accent-cyan)' : 'var(--color-info)'} strokeWidth="2" style={{ flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div className="sde-quickopen-item-name">
                    <HighlightedPath path={name} ranges={nameRanges} />
                  </div>
                  {dir && (
                    <div className="sde-quickopen-item-dir">
                      {dir}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="sde-quickopen-footer">
          {[['↑↓', 'navigate'], ['↵', 'open'], ['Esc', 'close']].map(([key, label]) => (
            <span key={key} className="sde-quickopen-footer-item">
              <kbd className="sde-quickopen-kbd">{key}</kbd>
              {label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>
            {filtered.length} of {allFiles.length} files
          </span>
        </div>
      </div>
    </>
  );
};
