import React from 'react';
import './Breadcrumbs.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { usePanelLayoutStore } from '../../../store/panelLayout';
import { useOutlineStore } from '../../../store/outline';
import { flattenSymbols } from '../../../utils/outlineTree';
import { ChevronRight, Eye } from 'lucide-react';

interface BreadcrumbsProps {
  filePath: string;
}

/** Workspace-relative path trail below the tab row; a trailing symbol segment (TS/JS only) shows the innermost symbol at the cursor, live-updating. */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ filePath }) => {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const { setSidebarTab, toggleLeftSidebar } = usePanelLayoutStore();
  const openFileAtLocation = useWorkspaceStore((s) => s.openFileAtLocation);
  const openMarkdownPreview = useWorkspaceStore((s) => s.openMarkdownPreview);
  const { symbols, supported, currentSymbol, activeFilePath } = useOutlineStore();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedWorkspace = (workspacePath || '').replace(/\\/g, '/');
  const relative = normalizedWorkspace && normalizedFile.startsWith(`${normalizedWorkspace}/`)
    ? normalizedFile.slice(normalizedWorkspace.length + 1)
    : normalizedFile;

  const segments = relative.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const revealInExplorer = () => {
    setSidebarTab('explorer');
    toggleLeftSidebar(true);
  };

  const fileName = segments[segments.length - 1];
  const showSymbolTrail = supported && activeFilePath === filePath && symbols.length > 0;
  const flatSymbols = React.useMemo(() => (dropdownOpen ? flattenSymbols(symbols) : []), [dropdownOpen, symbols]);
  const isMarkdown = /\.mdx?$/i.test(fileName);

  const jumpToSymbol = (line: number, column: number) => {
    openFileAtLocation(filePath, fileName, line, column);
    setDropdownOpen(false);
  };

  return (
    <div className="sde-breadcrumbs">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={12} className="sde-breadcrumb-sep" />}
            {isLast && !showSymbolTrail ? (
              <span className="sde-breadcrumb-segment sde-breadcrumb-segment--current">{segment}</span>
            ) : (
              <button className="sde-breadcrumb-segment" onClick={revealInExplorer} title="Reveal in Explorer">
                {segment}
              </button>
            )}
          </React.Fragment>
        );
      })}

      {showSymbolTrail && (
        <div className="sde-breadcrumb-symbol-wrap" ref={dropdownRef}>
          <ChevronRight size={12} className="sde-breadcrumb-sep" />
          <button
            className="sde-breadcrumb-segment sde-breadcrumb-segment--current sde-breadcrumb-symbol-btn"
            onClick={() => setDropdownOpen((v) => !v)}
            title="Go to Symbol"
          >
            {currentSymbol?.name ?? '(file)'}
          </button>

          {dropdownOpen && (
            <div className="sde-breadcrumb-symbol-dropdown">
              {flatSymbols.map(({ symbol, depth }, i) => (
                <button
                  key={`${symbol.name}-${symbol.startLine}-${i}`}
                  className={`sde-breadcrumb-symbol-item${symbol === currentSymbol ? ' active' : ''}`}
                  style={{ paddingLeft: 10 + depth * 14 }}
                  onClick={() => jumpToSymbol(symbol.startLine, symbol.startColumn)}
                >
                  <span className="sde-breadcrumb-symbol-name">{symbol.name}</span>
                  <span className="sde-breadcrumb-symbol-kind">{symbol.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isMarkdown && (
        <button
          className="sde-breadcrumb-preview-btn"
          onClick={() => openMarkdownPreview(filePath)}
          title="Open Preview"
        >
          <Eye size={13} />
        </button>
      )}
    </div>
  );
};
