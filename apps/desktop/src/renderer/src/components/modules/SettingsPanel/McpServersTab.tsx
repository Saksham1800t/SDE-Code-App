import React, { useEffect, useState } from 'react';
import './SettingsPanel.css';
import { Input } from '../../common/Input';
import { Button } from '../../common/Button';
import { Switch } from '../../common/Switch';
import { customConfirm } from '../../../store/confirm';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';
import type { McpServerConfig, McpServerState } from '@sde-code/protocol';
import { Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react';

function statusMeta(status: McpServerState['status'] | undefined) {
  switch (status) {
    case 'connected':   return { icon: <CheckCircle2 size={13} />, label: 'Connected', color: 'var(--color-success)' };
    case 'connecting':  return { icon: <Loader2 size={13} className="sde-mcp-spin" />, label: 'Connecting…', color: 'var(--text-muted)' };
    case 'error':       return { icon: <XCircle size={13} />, label: 'Error', color: 'var(--color-danger)' };
    default:            return { icon: <Circle size={13} />, label: 'Disconnected', color: 'var(--text-muted)' };
  }
}

/** Self-contained (unlike SyncTab): fetches/owns its own data since there's no shared settings state to thread through. */
export const McpServersTab: React.FC = () => {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [states, setStates] = useState<Record<string, McpServerState>>({});
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const api = window.api;
    if (!api?.mcpGetServers) return;
    const [serverList, stateList] = await Promise.all([api.mcpGetServers(), api.mcpGetServerStates()]);
    setServers(serverList);
    setStates(Object.fromEntries(stateList.map((s) => [s.id, s])));
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // One delayed re-check catches the connecting -> connected/error transition without continuous polling.
  const refreshSoon = () => {
    refresh();
    setTimeout(refresh, 2000);
  };

  const handleAdd = async () => {
    const api = window.api;
    if (!api?.mcpSaveServer || !name.trim() || !command.trim()) return;
    setSaving(true);
    try {
      const config: McpServerConfig = {
        id: `mcp_${Math.random().toString(36).slice(2, 11)}`,
        name: name.trim(),
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        enabled: true,
      };
      await api.mcpSaveServer(config);
      setName('');
      setCommand('');
      setArgs('');
      setShowAddForm(false);
      refreshSoon();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (server: McpServerConfig) => {
    const api = window.api;
    if (!api?.mcpSaveServer) return;
    await api.mcpSaveServer({ ...server, enabled: !server.enabled });
    refreshSoon();
  };

  const handleReconnect = async (id: string) => {
    const api = window.api;
    if (!api?.mcpReconnectServer) return;
    await api.mcpReconnectServer(id);
    refreshSoon();
  };

  const handleDelete = async (server: McpServerConfig) => {
    const api = window.api;
    if (!api?.mcpDeleteServer) return;
    if (!(await customConfirm(DIALOG_MESSAGES.mcp.confirmDeleteServer(server.name), { danger: true }))) return;
    await api.mcpDeleteServer(server.id);
    refresh();
  };

  if (loading) {
    return <div className="sde-settings-category"><p className="sde-muted-note">Loading…</p></div>;
  }

  return (
    <div className="sde-mcp-servers-tab">
      <p className="sde-settings-category-description">
        MCP (Model Context Protocol) servers expose tools the AI Assistant can call, the same way an
        extension's own contributed tools do. Configure a locally-installed server below — it launches
        as a background process and connects automatically once enabled.
      </p>

      <div className="sde-mcp-server-list">
        {servers.length === 0 ? (
          <p className="sde-muted-note">No MCP servers configured yet.</p>
        ) : (
          servers.map((server) => {
            const state = states[server.id];
            const meta = statusMeta(state?.status);
            return (
              <div key={server.id} className="sde-mcp-server-row">
                <div className="sde-mcp-server-info">
                  <div className="sde-mcp-server-name-row">
                    <span className="sde-mcp-server-name">{server.name}</span>
                    <span className="sde-mcp-server-status" style={{ color: meta.color }} title={state?.error}>
                      {meta.icon} {meta.label}
                      {state?.status === 'connected' && ` (${state.toolCount} tool${state.toolCount !== 1 ? 's' : ''})`}
                    </span>
                  </div>
                  <div className="sde-mcp-server-command">
                    {server.command} {server.args.join(' ')}
                  </div>
                  {state?.status === 'error' && state.error && (
                    <div className="sde-mcp-server-error">{state.error}</div>
                  )}
                </div>
                <div className="sde-mcp-server-actions">
                  <Switch checked={server.enabled} onChange={() => handleToggleEnabled(server)} size="sm" />
                  <button
                    className="sde-ghost-btn"
                    title="Reconnect"
                    disabled={!server.enabled}
                    onClick={() => handleReconnect(server.id)}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button className="sde-ghost-btn" title="Delete" onClick={() => handleDelete(server)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showAddForm ? (
        <div className="sde-mcp-add-form">
          <Input placeholder="Server name (e.g. filesystem)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Command (e.g. npx)" value={command} onChange={(e) => setCommand(e.target.value)} />
          <Input placeholder="Arguments (space-separated)" value={args} onChange={(e) => setArgs(e.target.value)} />
          <div className="sde-mcp-add-form-actions">
            <Button variant="secondary" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={saving || !name.trim() || !command.trim()} onClick={handleAdd}>
              {saving ? 'Adding…' : 'Add Server'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setShowAddForm(true)}>
          <Plus size={13} /> Add MCP Server
        </Button>
      )}
    </div>
  );
};
