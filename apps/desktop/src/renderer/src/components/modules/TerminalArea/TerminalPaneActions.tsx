import React, { useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { useTerminalStore } from '../../../store/terminal';
import { ensureTasksLoadedThenAlertIfEmpty } from '../../../store/tasks';
import { TaskPickerDialog } from '../TaskRunner/TaskPickerDialog';
import type { PanelTabActionsProps } from '../../../panel/panelTabRegistry';

/** Terminal's per-view Panel toolbar actions, registered via PanelTabDescriptor.renderActions; reads the store directly rather than via props. */
export const TerminalPaneActions: React.FC<PanelTabActionsProps> = () => {
  const { createNewTerminal, closeTerminal, activeTerminalId } = useTerminalStore();
  const [isTaskPickerOpen, setTaskPickerOpen] = useState(false);

  return (
    <>
      <button
        className="sde-icon-btn"
        title="Run Task..."
        onClick={() => ensureTasksLoadedThenAlertIfEmpty(() => setTaskPickerOpen(true))}
      >
        <Play size={14} />
      </button>
      <button
        className="sde-icon-btn"
        title="New Terminal (Ctrl+Shift+`)"
        onClick={() => createNewTerminal()}
      >
        <Plus size={14} />
      </button>
      <button
        className="sde-icon-btn sde-icon-btn--danger"
        title="Kill Active Terminal"
        onClick={() => { if (activeTerminalId) closeTerminal(activeTerminalId); }}
      >
        <Trash2 size={14} />
      </button>
      {isTaskPickerOpen && <TaskPickerDialog onClose={() => setTaskPickerOpen(false)} />}
    </>
  );
};
