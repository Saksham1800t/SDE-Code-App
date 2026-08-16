import React, { useEffect, useState } from 'react';
import './ImpactReportPanel.css';
import type { ImpactReport, ImpactReportEntry } from '@sde-code/protocol';
import { FileCode2, GitBranch, FlaskConical, Play, Network } from 'lucide-react';
import { useCodeMapStore } from '../../../store/codeMapStore';
import { useWorkspaceStore } from '../../../store/workspace';
import { findOwningFolder, toAbsolutePath, fetchImpactForFile, runSuggestedTests } from '../../../utils/codeMapImpact';

export const ImpactReportPanel: React.FC = () => {
  const impactTargetFilePath = useCodeMapStore((s) => s.impactTargetFilePath);
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [runStatus, setRunStatus] = useState<'idle' | 'running'>('idle');

  const owningFolder = impactTargetFilePath ? findOwningFolder(impactTargetFilePath, workspaceFolders) : undefined;

  useEffect(() => {
    if (!impactTargetFilePath || !owningFolder) {
      setReport(null);
      return;
    }
    setIsLoading(true);
    fetchImpactForFile(impactTargetFilePath, workspaceFolders)
      .then(setReport)
      .finally(() => setIsLoading(false));
  }, [impactTargetFilePath, owningFolder?.path]);

  const handleOpenEntry = (relPath: string) => {
    if (!owningFolder) return;
    const absPath = toAbsolutePath(relPath, owningFolder);
    openFile(absPath, relPath.split('/').pop() || relPath);
  };

  const handleRunSuggestedTests = async () => {
    if (!report || report.suggestedTests.length === 0 || !owningFolder) return;
    setRunStatus('running');
    try {
      await runSuggestedTests(owningFolder.path, report.suggestedTests);
    } finally {
      setRunStatus('idle');
    }
  };

  const renderEntryGroup = (title: string, icon: React.ReactNode, entries: ImpactReportEntry[]) => (
    <div className="sde-impact-group">
      <div className="sde-impact-group-title">
        {icon}
        {title}
        <span className="sde-impact-group-count">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="sde-impact-empty">None found</div>
      ) : (
        entries.map((entry) => (
          <button key={entry.filePath} className="sde-impact-entry" onClick={() => handleOpenEntry(entry.filePath)}>
            <FileCode2 size={13} />
            <span className="sde-impact-entry-path">{entry.filePath}</span>
          </button>
        ))
      )}
    </div>
  );

  if (!impactTargetFilePath) {
    return (
      <div className="sde-impact-panel">
        <div className="sde-impact-placeholder">Right-click a file and choose "Analyze Impact" to see what could be affected by a change.</div>
      </div>
    );
  }

  return (
    <div className="sde-impact-panel">
      <div className="sde-impact-header">
        <FileCode2 size={13} />
        <span className="sde-impact-target-path">{report?.filePath ?? impactTargetFilePath}</span>
        <button
          className="sde-impact-view-in-map-btn"
          onClick={() => useCodeMapStore.getState().focusNodeInCanvas(impactTargetFilePath)}
          title="View in Code Map"
        >
          <Network size={13} />
          View in Code Map
        </button>
      </div>

      {isLoading ? (
        <div className="sde-impact-placeholder">Analyzing...</div>
      ) : !report ? (
        <div className="sde-impact-placeholder">No impact data available — index this workspace first.</div>
      ) : (
        <>
          <div className="sde-impact-disclaimer">
            Route/URL matching and suggested tests are heuristic — treat these as a starting point, not a guarantee.
          </div>
          {renderEntryGroup('Directly imports this', <GitBranch size={13} />, report.directlyImports)}
          {renderEntryGroup('Matches this route', <GitBranch size={13} />, report.matchesRoute)}

          <div className="sde-impact-group">
            <div className="sde-impact-group-title">
              <FlaskConical size={13} />
              Suggested tests
              <span className="sde-impact-group-count">{report.suggestedTests.length}</span>
            </div>
            {report.suggestedTests.length === 0 ? (
              <div className="sde-impact-empty">None found</div>
            ) : (
              <>
                {report.suggestedTests.map((testPath) => (
                  <button key={testPath} className="sde-impact-entry" onClick={() => handleOpenEntry(testPath)}>
                    <FileCode2 size={13} />
                    <span className="sde-impact-entry-path">{testPath}</span>
                  </button>
                ))}
                <button className="sde-btn sde-btn--primary sde-btn--sm sde-impact-run-btn" onClick={handleRunSuggestedTests} disabled={runStatus === 'running'}>
                  <Play size={12} />
                  Run Suggested Tests
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
