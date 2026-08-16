import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import './AssistantPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useAgentStore } from '../../../store/agent';
import { Button } from '../../common/Button';

const registerDiffTheme = (monaco: any) => {
  monaco.editor.defineTheme('sde-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0d0f14',
      'diffEditor.insertedTextBackground': '#3fb95022',
      'diffEditor.removedTextBackground': '#f8514922',
      'diffEditor.insertedLineBackground': '#3fb95012',
      'diffEditor.removedLineBackground': '#f8514912',
      'diffEditor.border': '#ffffff10',
    },
  });
};


export const AgentWorkingSetPanel: React.FC = () => {
  const { workspacePath } = useWorkspaceStore();
  const { agentWorkingSet, acceptAgentFileChange, rejectAgentFileChange, acceptAllAgentFileChanges, rejectAllAgentFileChanges } =
    useAgentStore();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  const changes = Object.values(agentWorkingSet);
  if (changes.length === 0) {
    return null;
  }

  const relativePath = (filePath: string) =>
    workspacePath && filePath.startsWith(`${workspacePath}/`) ? filePath.slice(workspacePath.length + 1) : filePath;

  const badge = (change: (typeof changes)[number]) =>
    change.isDeleted ? { label: 'DELETED', className: 'sde-agent-badge--deleted' } :
      change.isNew ? { label: 'NEW', className: 'sde-agent-badge--new' } :
        { label: 'MODIFIED', className: 'sde-agent-badge--modified' };

  return (
    <div className="sde-agent-working-set">
      <div className="sde-agent-working-set-header">
        <span className="sde-agent-working-set-title">
          Agent proposed changes ({changes.length})
        </span>
        <div className="sde-agent-working-set-header-actions">
          <Button size="sm" variant="primary" onClick={() => acceptAllAgentFileChanges()}>
            Accept All
          </Button>
          <Button size="sm" variant="danger" onClick={() => rejectAllAgentFileChanges()}>
            Reject All
          </Button>
        </div>
      </div>

      <div className="sde-agent-working-set-list">
        {changes.map((change) => {
          const isExpanded = expandedPath === change.filePath;
          const b = badge(change);
          return (
            <div key={change.filePath} className="sde-agent-working-set-item">
              <div
                className="sde-agent-working-set-row"
                onClick={() => setExpandedPath(isExpanded ? null : change.filePath)}
              >
                <span className={`sde-agent-badge ${b.className}`}>{b.label}</span>
                <span className="sde-agent-working-set-path" title={change.filePath}>
                  {relativePath(change.filePath)}
                </span>
                <div className="sde-agent-working-set-row-actions" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="primary" onClick={() => acceptAgentFileChange(change.filePath)}>
                    Accept
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => rejectAgentFileChange(change.filePath)}>
                    Reject
                  </Button>
                </div>
              </div>

              {isExpanded && (
                <div className="sde-agent-working-set-diff">
                  <DiffEditor
                    height="300px"
                    theme="sde-dark"
                    beforeMount={registerDiffTheme}
                    original={change.originalContent}
                    modified={change.proposedContent}
                    options={{
                      readOnly: true,
                      originalEditable: false,
                      fontSize: 13,
                      fontFamily: 'var(--font-mono)',
                      minimap: { enabled: false },
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      renderSideBySide: true,
                      padding: { top: 8, bottom: 8 },
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
