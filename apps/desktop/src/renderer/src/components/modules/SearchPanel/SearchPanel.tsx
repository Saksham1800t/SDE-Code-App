import React, { useState, useCallback, useRef, useEffect } from 'react';
import './SearchPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useSearchSettingsStore } from '../../../store/searchSettings';
import { formatSearchEditorDocument } from '../../../utils/searchEditorFormat';
import { buildExcerptSourcesFromSearchResults } from '../../../utils/multibuffer';
import { FileSearch, Layers } from 'lucide-react';

interface SearchMatch {
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchResult {
  file: string;
  relativePath: string;
  matches: SearchMatch[];
}

export const SearchPanel: React.FC = () => {
  const { workspaceFolders, openFile, openSearchEditorTab, openMultibufferTab } = useWorkspaceStore();
  const [query, setQuery] = useState('');
  const { includeGlob, excludeGlob, setIncludeGlob, setExcludeGlob, initializeSearchSettings } = useSearchSettingsStore();
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showReplace, setShowReplace] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  const [replacing, setReplacing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (workspaceFolders.length === 0 || !q.trim()) { setResults([]); setTotalMatches(0); return; }
    setIsSearching(true);
    try {
      const api = window.api;
      const perFolder = await Promise.all(
        workspaceFolders.map((f) => api.searchInFiles(f.path, q, { caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob })),
      );
      // Multi-root: relativePath is prefixed with the folder name for display since it alone would collide across folders.
      const multiRoot = workspaceFolders.length > 1;
      const res: SearchResult[] = perFolder.flatMap((results: SearchResult[], i) =>
        multiRoot ? results.map((r) => ({ ...r, relativePath: `${workspaceFolders[i].name}/${r.relativePath}` })) : results,
      );
      setResults(res);
      setTotalMatches(res.reduce((acc, r) => acc + r.matches.length, 0));
      setExpandedFiles(new Set(res.map(r => r.relativePath)));
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [workspaceFolders, caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob]);

  const handleReplace = useCallback(async (targetFile?: string) => {
    if (workspaceFolders.length === 0 || !query.trim()) return;
    setReplacing(true);
    try {
      const api = window.api;
      const options = { caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob };
      if (targetFile) {
        // Replacing within one specific file — target just the folder it's actually under.
        const owningFolder = workspaceFolders.find((f) => targetFile.startsWith(f.path))?.path ?? workspaceFolders[0].path;
        await api.replaceInFiles(owningFolder, query, replaceText, options, targetFile);
      } else {
        await Promise.all(workspaceFolders.map((f) => api.replaceInFiles(f.path, query, replaceText, options)));
      }
      await doSearch(query);
    } catch (err) {
      console.error('Replace failed:', err);
    } finally {
      setReplacing(false);
    }
  }, [workspaceFolders, query, replaceText, caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob, doSearch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  useEffect(() => { initializeSearchSettings(); }, []);

  const toggleFile = (relPath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath); else next.add(relPath);
      return next;
    });
  };

  const handleOpenMatch = (file: string) => {
    openFile(file, file.split(/[/\\]/).pop() || file);
  };

  const highlightMatch = (text: string, start: number, end: number) => {
    const trim = (s: string, max = 40) => s.length > max ? '…' + s.slice(-max) : s;
    const pre = text.slice(0, start);
    const match = text.slice(start, end);
    const post = text.slice(end);
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
        {trim(pre)}
        <mark className="sde-search-mark">{match}</mark>
        {post.slice(0, 60)}{post.length > 60 ? '…' : ''}
      </span>
    );
  };

  return (
    <div className="sde-search-panel">
      {/* Header */}
      <div className="sde-panel-header">
        <span>SEARCH</span>
        <button
          className="sde-ghost-btn"
          onClick={() => setShowReplace(s => !s)}
          title="Toggle Replace"
        >
          {showReplace ? '▾' : '▸'} Replace
        </button>
        <button
          className="sde-ghost-btn"
          disabled={results.length === 0}
          title="Open as Search Editor — a saved, re-runnable document"
          onClick={() => {
            const options = { caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob };
            openSearchEditorTab(query, options, formatSearchEditorDocument(query, options, results));
          }}
        >
          <FileSearch size={13} />
        </button>
        <button
          className="sde-ghost-btn"
          disabled={results.length === 0}
          title="Open as Multibuffer — an editable view of every match with its surrounding context, saved back to each source file"
          onClick={() => openMultibufferTab(query, buildExcerptSourcesFromSearchResults(results))}
        >
          <Layers size={13} />
        </button>
      </div>

      {/* Search inputs */}
      <div className="sde-search-inputs">
        {/* Query row */}
        <div className="sde-search-input-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" className="sde-search-input-icon">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            className="sde-search-input"
            style={{ paddingRight: 64 }}
          />
          <div className="sde-search-toggles">
            <button className={`sde-search-toggle-btn${caseSensitive ? ' active' : ''}`} title="Match Case" onClick={() => setCaseSensitive(v => !v)}>Aa</button>
            <button className={`sde-search-toggle-btn${wholeWord ? ' active' : ''}`} title="Match Whole Word" onClick={() => setWholeWord(v => !v)}>ab</button>
            <button className={`sde-search-toggle-btn${isRegex ? ' active' : ''}`} title="Use Regular Expression" onClick={() => setIsRegex(v => !v)}>.*</button>
          </div>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              placeholder="Replace"
              className="sde-search-replace-input"
              style={{ flex: 1 }}
            />
            <button
              className="sde-search-toggle-btn"
              title="Replace All"
              disabled={replacing || totalMatches === 0}
              onClick={() => handleReplace()}
            >
              {replacing ? '…' : 'Replace All'}
            </button>
          </div>
        )}

        {/* Glob filters */}
        <div className="sde-search-filter-row">
          <input value={includeGlob} onChange={e => setIncludeGlob(e.target.value)} placeholder="files to include (e.g. *.ts)" className="sde-search-filter-input" />
          <input value={excludeGlob} onChange={e => setExcludeGlob(e.target.value)} placeholder="files to exclude" className="sde-search-filter-input" />
        </div>
      </div>

      {/* Results summary */}
      {query && (
        <div className="sde-search-summary">
          {isSearching ? 'Searching…' : results.length === 0 ? 'No results' : `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${results.length} file${results.length !== 1 ? 's' : ''}`}
        </div>
      )}

      {/* Results list */}
      <div className="sde-search-results">
        {results.map(result => (
          <div key={result.relativePath}>
            {/* File header */}
            <div className="sde-search-file-header" onClick={() => toggleFile(result.relativePath)}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" style={{ transform: expandedFiles.has(result.relativePath) ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="sde-search-file-name">{result.relativePath.split('/').pop()}</span>
              <span className="sde-search-file-dir">{result.relativePath.includes('/') ? result.relativePath.slice(0, result.relativePath.lastIndexOf('/')) : ''}</span>
              {showReplace && (
                <button
                  className="sde-ghost-btn"
                  title="Replace All in File"
                  disabled={replacing}
                  onClick={(e) => { e.stopPropagation(); handleReplace(result.file); }}
                >
                  ↺
                </button>
              )}
              <span className="sde-badge">{result.matches.length}</span>
            </div>

            {/* Match lines */}
            {expandedFiles.has(result.relativePath) && result.matches.map((match, i) => (
              <div
                key={i}
                className="sde-search-match-row"
                onClick={() => handleOpenMatch(result.file)}
              >
                <span className="sde-search-line-num">{match.line}</span>
                <div className="sde-search-match-text">
                  {highlightMatch(match.text.trim(), Math.max(0, match.matchStart - (match.text.length - match.text.trimStart().length)), match.matchEnd - (match.text.length - match.text.trimStart().length))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
