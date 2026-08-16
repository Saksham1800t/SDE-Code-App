import React, { useEffect, useRef } from 'react';
import './KeyboardShortcuts.css';
import { Modal } from '../../common/Modal';
import { Button } from '../../common/Button';
import { normalizeKeyEvent } from '../../../store/commands';
import { AlertTriangle } from 'lucide-react';

interface Command {
  id: string;
  name: string;
  category: string;
  description?: string;
}

interface Keybinding {
  command_id: string;
  key_combination: string;
}

interface ShortcutCaptureModalProps {
  editingCommandId: string | null;
  onClose: () => void;
  commands: Command[];
  platform: string;
  keybindings: Keybinding[];
  capturedKeys: string;
  setCapturedKeys: (val: string) => void;
  conflict: { existingCommandName: string; existingCommandId: string } | null;
  setConflict: (val: any) => void;
  handleSave: () => void;
  handleSaveWithConflictOverride: () => void;
}

export const ShortcutCaptureModal: React.FC<ShortcutCaptureModalProps> = ({
  editingCommandId,
  onClose,
  commands,
  platform,
  keybindings,
  capturedKeys,
  setCapturedKeys,
  conflict,
  setConflict,
  handleSave,
  handleSaveWithConflictOverride,
}) => {
  const captureInputRef = useRef<HTMLDivElement>(null);
  const editingCommand = commands.find((c) => c.id === editingCommandId);

  useEffect(() => {
    if (editingCommandId) {
      setTimeout(() => captureInputRef.current?.focus(), 100);
    }
  }, [editingCommandId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Must close directly here, not bubble to Modal.tsx's Escape listener — React's synthetic stopPropagation below would swallow it first.
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const ignoreList = ['Control', 'Shift', 'Alt', 'Meta'];
    if (ignoreList.includes(e.key)) return;

    const normalized = normalizeKeyEvent(e.nativeEvent, platform);
    setCapturedKeys(normalized);

    const existingBinding = keybindings.find(
      (k) => k.key_combination === normalized && k.command_id !== editingCommandId
    );

    if (existingBinding) {
      const targetCmd = commands.find((c) => c.id === existingBinding.command_id);
      setConflict({
        existingCommandId: existingBinding.command_id,
        existingCommandName: targetCmd ? targetCmd.name : existingBinding.command_id,
      });
    } else {
      setConflict(null);
    }
  };

  return (
    <Modal
      isOpen={!!editingCommandId}
      onClose={onClose}
      title={`Edit Shortcut: ${editingCommand ? editingCommand.name : ''}`}
    >
      <div
        ref={captureInputRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={`sde-captured-keys-box${capturedKeys ? ' active' : ''}`}
      >
        {capturedKeys || 'Press key combination...'}
      </div>

      <p className="sde-muted-note" style={{ padding: 0 }}>
        Press keys like Ctrl, Shift, Alt, plus normal keys. Press Esc to cancel.
      </p>

      {conflict && (
        <div className="sde-conflict-banner">
          <div className="sde-conflict-title"><AlertTriangle size={13} /> Conflict Detected</div>
          <div>
            This shortcut is currently assigned to "<strong>{conflict.existingCommandName}</strong>".
          </div>
        </div>
      )}

      <div className="sde-flex-row" style={{ justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
        <Button
          onClick={onClose}
          variant="ghost"
        >
          Cancel
        </Button>

        {conflict ? (
          <Button
            onClick={handleSaveWithConflictOverride}
            variant="purple"
          >
            Replace & Reassign
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            disabled={!capturedKeys}
            variant={capturedKeys ? 'primary' : 'secondary'}
          >
            Save
          </Button>
        )}
      </div>
    </Modal>
  );
};
