import React, { useEffect, useState } from 'react';
import './ProblemsPanel.css';
import { useProblemsStore, ProblemEntry } from '../../../store/problems';
import { useWorkspaceStore } from '../../../store/workspace';
import { AlertCircle, AlertTriangle, Info, ChevronRight, FileText } from 'lucide-react';

const severityIcon = (severity: ProblemEntry['severity']) => {
  switch (severity) {
    case 'error':
      return <AlertCircle size={13} className="sde-problem-icon sde-problem-icon--error" />;
    case 'warning':
      return <AlertTriangle size={13} className="sde-problem-icon sde-problem-icon--warning" />;
    default:
      return <Info size={13} className="sde-problem-icon sde-problem-icon--info" />;
  }
};

export const ProblemsPanel: React.FC = () => {
  const { problems, errorCount, warningCount } = useProblemsStore();
  const { openFileAtLocation, workspacePath } = useWorkspaceStore();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);

  const visibleProblems = problems.filter((p) => {
    if (p.severity === 'error') return showErrors;
    if (p.severity === 'warning') return showWarnings;
    return true; // info/hint entries aren't gated by either toggle
  });

  // Auto-expand a file the first time it shows up with problems, mirroring
  // SearchPanel's "expand everything on a fresh result set" behavior.
  useEffect(() => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      for (const p of problems) next.add(p.filePath);
      return next;
    });
  }, [problems]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
      return next;
    });
  };

  const relativePath = (filePath: string) => {
    if (workspacePath) {
      const norm = workspacePath.replace(/\\/g, '/');
      if (filePath.startsWith(`${norm}/`)) return filePath.slice(norm.length + 1);
    }
    return filePath;
  };

  // Map preserves insertion order, so grouping keeps sortProblems' worst-severity-first order intact.
  const grouped = new Map<string, ProblemEntry[]>();
  for (const p of visibleProblems) {
    const list = grouped.get(p.filePath) ?? [];
    list.push(p);
    grouped.set(p.filePath, list);
  }

  return (
    <div className="sde-problems-panel">
      {problems.length > 0 && (
        <div className="sde-problems-filter-bar">
          <button
            className={`sde-problems-filter-btn${showErrors ? ' active' : ''}`}
            onClick={() => setShowErrors((v) => !v)}
          >
            <AlertCircle size={12} className="sde-problem-icon--error" /> {errorCount}
          </button>
          <button
            className={`sde-problems-filter-btn${showWarnings ? ' active' : ''}`}
            onClick={() => setShowWarnings((v) => !v)}
          >
            <AlertTriangle size={12} className="sde-problem-icon--warning" /> {warningCount}
          </button>
        </div>
      )}
      {problems.length === 0 ? (
        <div className="sde-problems-empty">No problems detected in open files.</div>
      ) : visibleProblems.length === 0 ? (
        <div className="sde-problems-empty">No problems match the current filter.</div>
      ) : (
        <div className="sde-problems-list">
          {Array.from(grouped.entries()).map(([filePath, entries]) => {
            const rel = relativePath(filePath);
            const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
            const isExpanded = expandedFiles.has(filePath);
            return (
              <div key={filePath}>
                <div className="sde-problems-file-header" onClick={() => toggleFile(filePath)}>
                  <ChevronRight size={11} className={`sde-problems-chevron${isExpanded ? ' expanded' : ''}`} />
                  <FileText size={13} className="sde-problems-file-icon" />
                  <span className="sde-problems-file-name">{entries[0].fileName}</span>
                  <span className="sde-problems-file-dir">{dir}</span>
                  <span className="sde-badge">{entries.length}</span>
                </div>

                {isExpanded && entries.map((entry, i) => (
                  <div
                    key={i}
                    className="sde-problems-row"
                    onClick={() => openFileAtLocation(entry.filePath, entry.fileName, entry.line, entry.column)}
                    title={entry.source ? `${entry.message} (${entry.source})` : entry.message}
                  >
                    {severityIcon(entry.severity)}
                    <span className="sde-problems-message">{entry.message}</span>
                    <span className="sde-problems-location">{entry.line}:{entry.column}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
