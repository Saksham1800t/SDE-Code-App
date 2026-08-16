import React, { useEffect, useRef } from 'react';
import './DebugPanel.css';
import { useDebugStore } from '../../../store/debug';
import { useWorkspaceStore } from '../../../store/workspace';
import { findOwningFolder } from '../../../utils/codeMapImpact';
import { startDebugSession, isDebuggableFile } from '../../../debug/debugSession';

const STATUS_LABEL: Record<string, string> = {
  starting: 'Starting…',
  running: 'Running',
  paused: 'Paused',
  terminated: 'Terminated',
  error: 'Error',
};

export const DebugPanel: React.FC = () => {
  const { sessions, activeSessionId } = useDebugStore();
  const { openFileAtLocation, activeTabPath, workspaceFolders } = useWorkspaceStore();
  const consoleRef = useRef<HTMLDivElement>(null);

  const session = activeSessionId ? sessions[activeSessionId] : undefined;

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.console.length]);

  if (!session) {
    const canDebugActiveFile = !!activeTabPath && isDebuggableFile(activeTabPath);
    return (
      <div className="sde-debug-panel">
        <div className="sde-debug-empty">
          {canDebugActiveFile ? (
            <button
              className="sde-btn sde-btn--primary sde-btn--sm"
              onClick={() => {
                const cwd = findOwningFolder(activeTabPath!, workspaceFolders)?.path ?? workspaceFolders[0]?.path ?? '';
                void startDebugSession(activeTabPath!, cwd);
              }}
            >
              Start Debugging {activeTabPath!.split('/').pop()}
            </button>
          ) : (
            'No active debug session. Open a Python file to start debugging.'
          )}
        </div>
      </div>
    );
  }

  const fileName = session.filePath.split('/').pop() ?? session.filePath;

  return (
    <div className="sde-debug-panel">
      <div className="sde-debug-status">
        <span className={`sde-debug-status-dot sde-debug-status-dot--${session.status}`} />
        <span>{STATUS_LABEL[session.status] ?? session.status}{session.error ? `: ${session.error}` : ''}</span>
        <span style={{ color: 'var(--text-muted)' }}>— {fileName}</span>
      </div>

      <div className="sde-debug-body">
        <div className="sde-debug-section">
          <div className="sde-debug-section-header">Call Stack</div>
          {session.callStack.length === 0 ? (
            <div className="sde-debug-frame" style={{ cursor: 'default', color: 'var(--text-muted)' }}>Not paused.</div>
          ) : (
            session.callStack.map((frame, i) => (
              <div
                key={frame.id}
                className={`sde-debug-frame${i === 0 ? ' sde-debug-frame--top' : ''}`}
                onClick={() => {
                  const path = frame.source?.path ?? session.filePath;
                  const name = path.split('/').pop() ?? path;
                  void openFileAtLocation(path, name, frame.line, frame.column);
                }}
              >
                {frame.name}
                <span className="sde-debug-frame-location">
                  {(frame.source?.name ?? fileName)}:{frame.line}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="sde-debug-section">
          <div className="sde-debug-section-header">Variables</div>
          {session.variableScopes.length === 0 ? (
            <div className="sde-debug-frame" style={{ cursor: 'default', color: 'var(--text-muted)' }}>Not paused.</div>
          ) : (
            session.variableScopes.map((scope) => (
              <div key={scope.scopeName}>
                <div className="sde-debug-scope-name">{scope.scopeName}</div>
                {scope.variables.map((v) => (
                  <div key={v.name} className="sde-debug-var">
                    <span className="sde-debug-var-name">{v.name}</span>
                    <span className="sde-debug-var-value">{v.value}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="sde-debug-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="sde-debug-section-header">Debug Console</div>
          <div ref={consoleRef} className="sde-debug-console">
            {session.console.map((line, i) => (
              <div key={i} className={`sde-debug-console-line${line.category === 'stderr' ? ' sde-debug-console-line--stderr' : ''}`}>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
