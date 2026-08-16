import React, { useState } from 'react';
import './OutlinePanel.css';
import { ChevronRight, ChevronDown, ListTree } from 'lucide-react';
import { useOutlineStore } from '../../../store/outline';
import { useWorkspaceStore } from '../../../store/workspace';
import { flattenSymbols } from '../../../utils/outlineTree';

/** Collapsible "Outline" sidebar section (TS/JS only); renders nothing when there's no active file to avoid an empty section. */
export const OutlinePanel: React.FC = () => {
  const { symbols, supported, currentSymbol, activeFilePath } = useOutlineStore();
  const openFileAtLocation = useWorkspaceStore((s) => s.openFileAtLocation);
  const [collapsed, setCollapsed] = useState(false);

  if (!activeFilePath) return null;

  const fileName = activeFilePath.split(/[\\/]/).pop() || activeFilePath;
  const flat = collapsed ? [] : flattenSymbols(symbols);

  return (
    <div className="sde-outline-panel">
      <button className="sde-outline-header" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <ListTree size={13} />
        <span className="sde-outline-header-label">OUTLINE</span>
        {supported && symbols.length > 0 && <span className="sde-badge">{symbols.length}</span>}
      </button>

      {!collapsed && (
        <div className="sde-outline-body">
          {!supported ? (
            <div className="sde-outline-empty">Outline isn't available for {fileName}.</div>
          ) : symbols.length === 0 ? (
            <div className="sde-outline-empty">No symbols found.</div>
          ) : (
            flat.map(({ symbol, depth }, i) => (
              <button
                key={`${symbol.name}-${symbol.startLine}-${i}`}
                className={`sde-outline-item${symbol === currentSymbol ? ' active' : ''}`}
                style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => openFileAtLocation(activeFilePath, fileName, symbol.startLine, symbol.startColumn)}
              >
                <span className="sde-outline-item-name">{symbol.name}</span>
                <span className="sde-outline-item-kind">{symbol.kind}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
