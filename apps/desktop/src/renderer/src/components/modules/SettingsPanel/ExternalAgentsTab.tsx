import React, { useEffect, useState } from 'react';
import './SettingsPanel.css';
import { Input } from '../../common/Input';
import { Button } from '../../common/Button';
import { customConfirm } from '../../../store/confirm';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';
import { tokenizeArgs } from '../../../utils/shellTokenize';
import { useExternalAgentsStore } from '../../../store/externalAgents';
import type { ExternalAgentConfig } from '@sde-code/protocol';
import { Plus, Trash2 } from 'lucide-react';

/** Mirrors McpServersTab's shape closely — a named external process, one CRUD list — but there's no connect/reconnect lifecycle here: an external agent isn't a long-lived background server, just a one-shot process run per prompt (see AssistantPanel.tsx's "External Agent" mode). */
export const ExternalAgentsTab: React.FC = () => {
  const { configs, loadConfigs, saveConfig, deleteConfig } = useExternalAgentsStore();
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfigs().finally(() => setLoading(false));
  }, [loadConfigs]);

  const handleAdd = async () => {
    if (!name.trim() || !command.trim()) return;
    setSaving(true);
    try {
      const config: ExternalAgentConfig = {
        id: `extagent_${Math.random().toString(36).slice(2, 11)}`,
        name: name.trim(),
        command: command.trim(),
        args: tokenizeArgs(args),
      };
      await saveConfig(config);
      setName('');
      setCommand('');
      setArgs('');
      setShowAddForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (config: ExternalAgentConfig) => {
    if (!(await customConfirm(DIALOG_MESSAGES.externalAgent.confirmDeleteConfig(config.name), { danger: true }))) return;
    await deleteConfig(config.id);
  };

  if (loading) {
    return <div className="sde-settings-category"><p className="sde-muted-note">Loading…</p></div>;
  }

  return (
    <div className="sde-mcp-servers-tab">
      <p className="sde-settings-category-description">
        External agents (Aider, the Claude Code CLI, a custom script, ...) run as a fully
        autonomous process — they own their own reasoning and file edits, not staged for review
        here. Output streams read-only into the "External Agent" mode of the AI Assistant panel.
        Use <code>{'{prompt}'}</code> in Arguments where the message should be inserted as a
        single argument; omit it and the message is piped to the process's stdin instead.
      </p>

      <div className="sde-mcp-server-list">
        {configs.length === 0 ? (
          <p className="sde-muted-note">No external agents configured yet.</p>
        ) : (
          configs.map((config) => (
            <div key={config.id} className="sde-mcp-server-row">
              <div className="sde-mcp-server-info">
                <div className="sde-mcp-server-name-row">
                  <span className="sde-mcp-server-name">{config.name}</span>
                </div>
                <div className="sde-mcp-server-command">
                  {config.command} {config.args.join(' ')}
                </div>
              </div>
              <div className="sde-mcp-server-actions">
                <button className="sde-ghost-btn" title="Delete" onClick={() => handleDelete(config)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddForm ? (
        <div className="sde-mcp-add-form">
          <Input placeholder="Name (e.g. Aider)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Command (e.g. aider)" value={command} onChange={(e) => setCommand(e.target.value)} />
          <Input placeholder='Arguments (e.g. --yes --message "{prompt}")' value={args} onChange={(e) => setArgs(e.target.value)} />
          <div className="sde-mcp-add-form-actions">
            <Button variant="secondary" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={saving || !name.trim() || !command.trim()} onClick={handleAdd}>
              {saving ? 'Adding…' : 'Add External Agent'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setShowAddForm(true)}>
          <Plus size={13} /> Add External Agent
        </Button>
      )}
    </div>
  );
};
