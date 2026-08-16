import React from 'react';
import { Play, ArrowRight, ArrowDown, ArrowUp, Square } from 'lucide-react';
import { useDebugStore } from '../../../store/debug';
import { continueSession, stepOver, stepIn, stepOut, stopSession } from '../../../debug/debugSession';
import type { PanelTabActionsProps } from '../../../panel/panelTabRegistry';

/** Debug panel's per-view toolbar — mirrors TerminalPaneActions' pattern of reading the store directly. Disabled until a session is active; Continue/Step disabled unless actually paused (mid-request while running would just error against the adapter). */
export const DebugPanelActions: React.FC<PanelTabActionsProps> = () => {
  const { sessions, activeSessionId } = useDebugStore();
  const session = activeSessionId ? sessions[activeSessionId] : undefined;
  const isPaused = session?.status === 'paused';
  const isLive = session?.status === 'running' || session?.status === 'paused' || session?.status === 'starting';

  return (
    <>
      <button className="sde-icon-btn" title="Continue" disabled={!isPaused} onClick={() => activeSessionId && continueSession(activeSessionId)}>
        <Play size={14} />
      </button>
      <button className="sde-icon-btn" title="Step Over" disabled={!isPaused} onClick={() => activeSessionId && stepOver(activeSessionId)}>
        <ArrowRight size={14} />
      </button>
      <button className="sde-icon-btn" title="Step Into" disabled={!isPaused} onClick={() => activeSessionId && stepIn(activeSessionId)}>
        <ArrowDown size={14} />
      </button>
      <button className="sde-icon-btn" title="Step Out" disabled={!isPaused} onClick={() => activeSessionId && stepOut(activeSessionId)}>
        <ArrowUp size={14} />
      </button>
      <button className="sde-icon-btn sde-icon-btn--danger" title="Stop Debugging" disabled={!isLive} onClick={() => activeSessionId && stopSession(activeSessionId)}>
        <Square size={14} />
      </button>
    </>
  );
};
