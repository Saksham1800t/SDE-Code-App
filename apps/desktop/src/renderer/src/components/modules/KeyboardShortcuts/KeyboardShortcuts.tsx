import React, { useEffect, useState } from 'react';
import './KeyboardShortcuts.css';
import { useCommandsStore } from '../../../store/commands';
import { ShortcutCaptureModal } from './ShortcutCaptureModal';
import { Button } from '../../common/Button';
import { Select } from '../../common/Select';
import { customAlert } from '../../../store/alerts';
import { customConfirm } from '../../../store/confirm';
import { customPrompt } from '../../../store/prompt';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';
import { Plus, Pencil, Trash2 } from 'lucide-react';

export const KeyboardShortcuts: React.FC = () => {
  const {
    commands,
    keybindings,
    platform,
    updateKeybinding,
    resetKeybindings,
    initialize,
    profiles,
    activeProfileId,
    setActiveProfileId,
    createProfile,
    renameProfile,
    deleteProfile,
  } = useCommandsStore();

  const [search, setSearch] = useState('');
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null);
  const [capturedKeys, setCapturedKeys] = useState('');
  const [conflict, setConflict] = useState<{ existingCommandName: string; existingCommandId: string } | null>(null);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const filteredCommands = commands.filter((cmd) => {
    const term = search.toLowerCase();
    const kb = keybindings.find((k) => k.command_id === cmd.id);
    const keys = kb?.key_combination?.toLowerCase() || '';
    return (
      cmd.name.toLowerCase().includes(term) ||
      cmd.category.toLowerCase().includes(term) ||
      cmd.id.toLowerCase().includes(term) ||
      keys.includes(term)
    );
  });

  const handleStartEdit = (commandId: string) => {
    setEditingCommandId(commandId);
    setCapturedKeys('');
    setConflict(null);
  };

  const handleSave = async () => {
    if (!editingCommandId) return;
    const success = await updateKeybinding(editingCommandId, capturedKeys);
    if (success) {
      setEditingCommandId(null);
      setConflict(null);
    }
  };

  const handleSaveWithConflictOverride = async () => {
    if (!editingCommandId || !conflict) return;
    await updateKeybinding(conflict.existingCommandId, '');
    const success = await updateKeybinding(editingCommandId, capturedKeys);
    if (success) {
      setEditingCommandId(null);
      setConflict(null);
    }
  };

  const handleImportProfile = async (_profileType: 'vscode' | 'intellij' | 'cursor') => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const content = JSON.parse(evt.target?.result as string);
          let count = 0;

          if (Array.isArray(content)) {
            for (const item of content) {
              const vscodeCmd = item.command || '';
              const vscodeKey = item.key || '';
              if (!vscodeCmd || !vscodeKey) continue;

              let targetSdeCmdId = '';
              if (vscodeCmd.includes('files.save') || vscodeCmd === 'workbench.action.files.save') {
                targetSdeCmdId = 'file.saveFile';
              } else if (vscodeCmd.includes('undo')) {
                targetSdeCmdId = 'edit.undo';
              } else if (vscodeCmd.includes('redo')) {
                targetSdeCmdId = 'edit.redo';
              } else if (vscodeCmd.includes('copy')) {
                targetSdeCmdId = 'edit.copy';
              } else if (vscodeCmd.includes('paste')) {
                targetSdeCmdId = 'edit.paste';
              } else if (vscodeCmd.includes('cut')) {
                targetSdeCmdId = 'edit.cut';
              } else if (vscodeCmd.includes('explorer')) {
                targetSdeCmdId = 'view.explorer';
              } else if (vscodeCmd.includes('git') || vscodeCmd.includes('scm')) {
                targetSdeCmdId = 'view.git';
              } else if (vscodeCmd.includes('settings')) {
                targetSdeCmdId = 'view.settings';
              } else if (vscodeCmd.includes('terminal.toggle')) {
                targetSdeCmdId = 'terminal.toggle';
              }

              if (targetSdeCmdId) {
                const normalizedKey = vscodeKey
                  .split(' ')
                  .map((k: string) => {
                    return k
                      .split('+')
                      .map((p: string) => {
                        const word = p.trim().toLowerCase();
                        if (word === 'ctrl') return 'Ctrl';
                        if (word === 'cmd' || word === 'meta') return platform === 'darwin' ? 'Cmd' : 'Win';
                        if (word === 'alt') return 'Alt';
                        if (word === 'shift') return 'Shift';
                        return word.toUpperCase();
                      })
                      .join('+');
                  })[0];

                await updateKeybinding(targetSdeCmdId, normalizedKey);
                count++;
              }
            }
            customAlert(DIALOG_MESSAGES.keybindings.migrationComplete(count));
          } else {
            customAlert(DIALOG_MESSAGES.keybindings.invalidProfileFormat);
          }
        } catch (err) {
          console.error(err);
          customAlert(DIALOG_MESSAGES.keybindings.failedToParseKeymapFile);
        }
      };
      reader.readAsText(file);
    };
    fileInput.click();
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const handleCreateProfile = async () => {
    const name = await customPrompt('New profile name:', { title: 'New Profile' });
    if (!name || !name.trim()) return;
    const ok = await createProfile(name);
    if (!ok) customAlert(DIALOG_MESSAGES.keybindings.failedToCreateProfile);
  };

  const handleRenameProfile = async () => {
    if (!activeProfile || activeProfile.id === 'default') return;
    const name = await customPrompt('Rename profile:', { title: 'Rename Profile', defaultValue: activeProfile.name });
    if (!name || !name.trim() || name === activeProfile.name) return;
    await renameProfile(activeProfile.id, name);
  };

  const handleDeleteProfile = async () => {
    if (!activeProfile || activeProfile.id === 'default') return;
    if (!(await customConfirm(DIALOG_MESSAGES.keybindings.confirmDeleteProfile(activeProfile.name), { danger: true }))) return;
    await deleteProfile(activeProfile.id);
  };

  return (
    <div className="sde-flex-col sde-shortcuts-panel">
      {/* Profile picker — each profile carries its own keybindings, editor/
          terminal settings, and extension enablement (Phase 28 extended
          this beyond keybindings-only), switched via activeProfileId in
          store/commands.ts; editorSettings.ts/terminalSettings.ts/
          extensions.ts each read that same active profile at their own
          get/set-call sites, and setActiveProfileId re-runs their
          initializers so switching here takes effect everywhere at once.
          'default' can't be renamed or deleted, so those two actions are
          hidden for it rather than shown disabled. */}
      <div className="sde-shortcuts-profile-row">
        <span className="sde-shortcuts-profile-label">Profile</span>
        <Select
          size="sm"
          value={activeProfileId}
          onChange={(e) => setActiveProfileId(e.target.value)}
          options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          style={{ width: 'auto', minWidth: 140 }}
        />
        <button className="sde-shortcuts-profile-btn" title="New Profile" onClick={handleCreateProfile}>
          <Plus size={14} />
        </button>
        {activeProfile && activeProfile.id !== 'default' && (
          <>
            <button className="sde-shortcuts-profile-btn" title="Rename Profile" onClick={handleRenameProfile}>
              <Pencil size={13} />
            </button>
            <button className="sde-shortcuts-profile-btn sde-shortcuts-profile-btn--danger" title="Delete Profile" onClick={handleDeleteProfile}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      <div className="sde-shortcuts-header">
        <div className="sde-shortcuts-search-container">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="Search commands or shortcuts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sde-shortcuts-search-input"
          />
        </div>

        <div className="sde-flex-row" style={{ gap: '8px' }}>
          <Button onClick={() => resetKeybindings()}>
            Reset Defaults
          </Button>

          <Select
            size="sm"
            onChange={(e) => {
              if (e.target.value) {
                handleImportProfile(e.target.value as any);
                e.target.value = '';
              }
            }}
            style={{ width: 'auto' }}
          >
            <option value="">Import Profile...</option>
            <option value="vscode">VS Code (.json)</option>
            <option value="intellij">IntelliJ (.json)</option>
            <option value="cursor">Cursor (.json)</option>
          </Select>
        </div>
      </div>

      <div className="sde-shortcuts-list-container">
        <table className="sde-shortcuts-table">
          <thead className="sde-shortcuts-thead">
            <tr>
              <th className="sde-shortcuts-th">Command</th>
              <th className="sde-shortcuts-th">ID</th>
              <th className="sde-shortcuts-th">Shortcut</th>
              <th className="sde-shortcuts-th" style={{ width: '80px' }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredCommands.map((cmd) => {
              const kb = keybindings.find((k) => k.command_id === cmd.id);
              const binding = kb?.key_combination || 'None';

              return (
                <tr key={cmd.id} className="sde-shortcuts-tr">
                  <td className="sde-shortcuts-td">
                    <div className="sde-shortcuts-cmd-name">{cmd.name}</div>
                    <div className="sde-shortcuts-cmd-cat">{cmd.category}</div>
                  </td>
                  <td className="sde-shortcuts-td sde-shortcuts-cmd-id">
                    {cmd.id}
                  </td>
                  <td className="sde-shortcuts-td">
                    {binding !== 'None' ? (
                      <span className="sde-shortcuts-pill">
                        {binding}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>
                    )}
                  </td>
                  <td className="sde-shortcuts-td" style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => handleStartEdit(cmd.id)}
                      className="sde-shortcuts-edit-btn"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ShortcutCaptureModal
        editingCommandId={editingCommandId}
        onClose={() => {
          setEditingCommandId(null);
          setConflict(null);
        }}
        commands={commands}
        platform={platform}
        keybindings={keybindings}
        capturedKeys={capturedKeys}
        setCapturedKeys={setCapturedKeys}
        conflict={conflict}
        setConflict={setConflict}
        handleSave={handleSave}
        handleSaveWithConflictOverride={handleSaveWithConflictOverride}
      />
    </div>
  );
};
