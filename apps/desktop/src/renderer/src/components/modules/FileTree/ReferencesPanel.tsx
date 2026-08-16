import React, { useState } from 'react';
import './ReferencesPanel.css';
import { ChevronRight, ChevronDown, Link2 } from 'lucide-react';
import { useReferencesStore } from '../../../store/references';
import { useWorkspaceStore } from '../../../store/workspace';
import { groupReferencesByFile } from '../../../utils/referenceGrouping';

/** Persistent "References" sidebar section; unlike Outline it does NOT clear on tab switch since results are a deliberate snapshot. */
export const ReferencesPanel: React.FC = () => {
  const { loading, supported, symbolName, results } = useReferencesStore();
  const openFileAtLocation = useWorkspaceStore((s) => s.openFileAtLocation);
  const [collapsed, setCollapsed] = useState(false);

  if (supported === null && !loading) return null;

  const grouped = groupReferencesByFile(results);

  return (
    <div className="sde-references-panel">
      <button className="sde-references-header" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <Link2 size={13} />
        <span className="sde-references-header-label">
          REFERENCES{symbolName ? `: ${symbolName}` : ''}
        </span>
        {!loading && results.length > 0 && <span className="sde-badge">{results.length}</span>}
      </button>

      {!collapsed && (
        <div className="sde-references-body">
          {loading ? (
            <div className="sde-references-empty">Finding references…</div>
          ) : !supported ? (
            <div className="sde-references-empty">References aren't available for this file.</div>
          ) : results.length === 0 ? (
            <div className="sde-references-empty">No references found.</div>
          ) : (
            Array.from(grouped.entries()).map(([filePath, refs]) => (
              <div key={filePath}>
                <div className="sde-references-file-header">{refs[0].fileName}</div>
                {refs.map((r, i) => (
                  <button
                    key={i}
                    className="sde-references-item"
                    onClick={() => openFileAtLocation(filePath, r.fileName, r.line, r.column)}
                  >
                    <span className="sde-references-item-line">{r.line}</span>
                    <span className="sde-references-item-text">{r.lineText || ' '}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
