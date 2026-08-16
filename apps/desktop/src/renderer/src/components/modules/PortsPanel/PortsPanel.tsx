import React, { useEffect, useRef, useState } from 'react';
import './PortsPanel.css';
import type { PortEntry } from '@sde-code/protocol';
import { ExternalLink, Copy, Globe, X, Plus, Pencil, Check, AppWindow } from 'lucide-react';
import { useWorkspaceStore } from '../../../store/workspace';

const sourceLabel: Record<PortEntry['source'], string> = {
  terminal: 'Terminal',
  system: 'System',
  manual: 'Manual',
};

export const PortsPanel: React.FC = () => {
  const openBrowserPreviewTab = useWorkspaceStore((s) => s.openBrowserPreviewTab);
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [manualPortValue, setManualPortValue] = useState('');
  const [editingPort, setEditingPort] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [confirmingPort, setConfirmingPort] = useState<number | null>(null);
  const [tunnelBusyPort, setTunnelBusyPort] = useState<number | null>(null);
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.api;
    if (!api) return;

    api.listPorts().then(setPorts).catch(() => {});

    const offDetected = api.onPortDetected((entry: PortEntry) => {
      setPorts((prev) => {
        const next = prev.filter((p) => p.port !== entry.port);
        next.push(entry);
        return next.sort((a, b) => a.port - b.port);
      });
    });
    const offClosed = api.onPortClosed((port: number) => {
      setPorts((prev) => prev.filter((p) => p.port !== port));
    });

    return () => {
      offDetected();
      offClosed();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const handleAddManual = () => {
    const port = parseInt(manualPortValue, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return;
    window.api?.addManualPort(port);
    setManualPortValue('');
  };

  const handleRemove = (port: number) => {
    window.api?.removePort(port);
    setPorts((prev) => prev.filter((p) => p.port !== port));
  };

  const startEditingLabel = (entry: PortEntry) => {
    setEditingPort(entry.port);
    setEditingLabel(entry.label ?? '');
  };

  const commitLabel = (port: number) => {
    window.api?.setPortLabel(port, editingLabel.trim());
    setEditingPort(null);
  };

  const handleOpenBrowser = (entry: PortEntry) => {
    const url = entry.publicUrl ?? `http://localhost:${entry.port}`;
    window.api?.openExternal(url);
  };

  const handleOpenInApp = (entry: PortEntry) => {
    const url = entry.publicUrl ?? `http://localhost:${entry.port}`;
    openBrowserPreviewTab(url);
  };

  const handleCopyUrl = (entry: PortEntry) => {
    const url = entry.publicUrl ?? `http://localhost:${entry.port}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopiedPort(entry.port);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopiedPort(null), 1500);
    });
  };

  const handleStartTunnel = async (port: number) => {
    setConfirmingPort(null);
    setTunnelBusyPort(port);
    try {
      const result = await window.api?.startTunnel(port);
      if (result && 'url' in result) {
        setPorts((prev) => prev.map((p) => (p.port === port ? { ...p, publicUrl: result.url } : p)));
      }
    } finally {
      setTunnelBusyPort(null);
    }
  };

  const handleStopTunnel = async (port: number) => {
    setTunnelBusyPort(port);
    try {
      await window.api?.stopTunnel(port);
      setPorts((prev) => prev.map((p) => (p.port === port ? { ...p, publicUrl: undefined } : p)));
    } finally {
      setTunnelBusyPort(null);
    }
  };

  return (
    <div className="sde-ports-panel">
      <div className="sde-ports-panel-header">
        <span className="sde-ports-panel-title">Forwarded Ports</span>
        <div className="sde-ports-add-row">
          <input
            className="sde-ports-add-input"
            type="number"
            placeholder="Port number"
            value={manualPortValue}
            onChange={(e) => setManualPortValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddManual(); }}
          />
          <button className="sde-icon-btn" title="Forward a Port" onClick={handleAddManual}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="sde-ports-list">
        {ports.length === 0 && (
          <div className="sde-ports-empty">
            No forwarded ports yet. Run a dev server in the terminal, or add one manually above.
          </div>
        )}

        {ports.map((entry) => (
          <div key={entry.port} className="sde-ports-row">
            <div className="sde-ports-row-main">
              <span className="sde-ports-port-num">{entry.port}</span>

              {editingPort === entry.port ? (
                <input
                  className="sde-ports-label-input"
                  autoFocus
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={() => commitLabel(entry.port)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(entry.port); }}
                />
              ) : (
                <span
                  className="sde-ports-label"
                  onDoubleClick={() => startEditingLabel(entry)}
                  title="Double-click to rename"
                >
                  {entry.label || entry.processName || 'Unnamed'}
                </span>
              )}

              <span className={`sde-ports-source-badge sde-ports-source-badge--${entry.source}`}>
                {sourceLabel[entry.source]}
              </span>

              {entry.publicUrl && <span className="sde-ports-public-badge">PUBLIC</span>}
            </div>

            {entry.publicUrl && (
              <div className="sde-ports-public-url">{entry.publicUrl}</div>
            )}

            {confirmingPort === entry.port && (
              <div className="sde-ports-confirm">
                <span>
                  Make http://localhost:{entry.port} public? Anyone with the link can access it.
                </span>
                <button className="sde-ghost-btn" onClick={() => handleStartTunnel(entry.port)}>
                  <Check size={12} /> Confirm
                </button>
                <button className="sde-ghost-btn" onClick={() => setConfirmingPort(null)}>Cancel</button>
              </div>
            )}

            <div className="sde-ports-row-actions">
              <button className="sde-icon-btn" title="Open in Browser" onClick={() => handleOpenBrowser(entry)}>
                <ExternalLink size={13} />
              </button>
              <button className="sde-icon-btn" title="Open in App" onClick={() => handleOpenInApp(entry)}>
                <AppWindow size={13} />
              </button>
              <button className="sde-icon-btn" title="Copy URL" onClick={() => handleCopyUrl(entry)}>
                {copiedPort === entry.port ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button className="sde-icon-btn" title="Rename" onClick={() => startEditingLabel(entry)}>
                <Pencil size={13} />
              </button>
              {entry.publicUrl ? (
                <button
                  className="sde-icon-btn sde-icon-btn--danger"
                  title="Stop Forwarding"
                  disabled={tunnelBusyPort === entry.port}
                  onClick={() => handleStopTunnel(entry.port)}
                >
                  <Globe size={13} />
                </button>
              ) : (
                <button
                  className="sde-icon-btn"
                  title="Forward Publicly"
                  disabled={tunnelBusyPort === entry.port}
                  onClick={() => setConfirmingPort(entry.port)}
                >
                  <Globe size={13} />
                </button>
              )}
              <button className="sde-icon-btn sde-icon-btn--danger" title="Remove" onClick={() => handleRemove(entry.port)}>
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
