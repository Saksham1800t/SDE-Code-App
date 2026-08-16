import React, { useEffect, useState } from 'react';
import './ExtensionMarketplace.css';
import { useExtensionsStore } from '../../../store/extensions';
import { Button } from '../../common/Button';
import { Switch } from '../../common/Switch';
import { ExtensionIcon } from './ExtensionIcon';
import { resolveServerBaseUrl } from '../../../../../shared/serverConfig';
import { customAlert } from '../../../store/alerts';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';

const SERVER_URL = resolveServerBaseUrl(import.meta.env.VITE_SERVER_URL);

interface ExtensionDetailsPanelProps {
  extensionId: string;
}

export const ExtensionDetailsPanel: React.FC<ExtensionDetailsPanelProps> = ({ extensionId }) => {
  const { extensions, toggleExtension, installExtension, uninstallExtension } = useExtensionsStore();
  const [remoteExt, setRemoteExt] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);

  const localExt = extensions.find((e) => e.id === extensionId);
  const ext = localExt || remoteExt;

  useEffect(() => {
    if (!localExt) {
      fetchRemoteDetails();
    }
  }, [extensionId, localExt]);

  const fetchRemoteDetails = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/extensions`);
      if (response.ok) {
        const data = await response.json();
        const found = data.find((e: any) => e.id === extensionId);
        if (found) {
          setRemoteExt(found);
        }
      }
    } catch (err) {
      console.error('Failed to load extension details from backend:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async () => {
    if (!ext) return;
    const res = await toggleExtension(ext.id, !ext.isEnabled);
    if (!res.success) {
      customAlert(DIALOG_MESSAGES.extensions.toggleFailed(res.message));
    } else if (res.message) {
      customAlert(res.message);
    }
  };

  const handleInstall = async () => {
    if (!ext) return;
    setInstalling(true);
    const api = window.api;
    if (!api || !api.downloadExtension) {
      customAlert(DIALOG_MESSAGES.extensions.installerBridgeMissing);
      setInstalling(false);
      return;
    }

    try {
      const downloadUrl = `${SERVER_URL}/api/extensions/download/${ext.id}/${ext.version}`;
      const manifest = await api.downloadExtension(downloadUrl, ext.id, ext.version);

      await installExtension({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        publisher: manifest.publisher,
        type: 'marketplace',
        provides: Array.isArray(manifest.provides) ? manifest.provides : Object.keys(manifest.provides || {}),
        dependsOn: manifest.dependsOn,
        categories: ext.categories || [],
        tags: ext.tags || [],
        manifestJson: JSON.stringify(manifest)
      });

      customAlert(DIALOG_MESSAGES.extensions.installSuccess(manifest.name));
    } catch (err: any) {
      customAlert(DIALOG_MESSAGES.extensions.installFailed(err));
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async () => {
    if (!ext) return;
    const res = await uninstallExtension(ext.id);
    if (!res.success) {
      customAlert(DIALOG_MESSAGES.extensions.uninstallFailed(res.message));
    } else {
      customAlert(DIALOG_MESSAGES.extensions.uninstallSuccess);
      setRemoteExt(ext); // Keep metadata in remote state since it is uninstalled locally
    }
  };

  if (loading) {
    return (
      <div className="sde-settings-loading">
        Querying details for {extensionId}...
      </div>
    );
  }

  if (!ext) {
    return (
      <div className="sde-settings-loading" style={{ color: 'var(--text-muted)' }}>
        Extension details not found.
      </div>
    );
  }

  const isInstalled = !!localExt;
  const isCore = ext.type === 'core';

  return (
    <div className="sde-ext-details">
      <div className="sde-ext-details-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ExtensionIcon seed={ext.id} size={64} />

          <div className="sde-ext-details-info">
            <div className="sde-ext-details-title-row">
              <h1 className="sde-ext-details-name">{ext.name}</h1>
              <span className={`sde-ext-card-type-tag sde-ext-card-type-tag--${ext.type}`} style={{ fontWeight: 700, letterSpacing: '0.5px' }}>{ext.type}</span>
            </div>

            <div className="sde-ext-details-publisher-row">
              v{ext.version} | by <span style={{ color: 'var(--accent-cyan)' }}>{ext.publisher}</span>
            </div>
          </div>
        </div>

        <div className="sde-ext-details-actions">
          {isInstalled ? (
            <>
              {!isCore && (
                <div className="sde-ext-details-switch-container">
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {ext.isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch
                    checked={ext.isEnabled}
                    onChange={handleToggle}
                  />
                </div>
              )}

              {isCore ? (
                <Button disabled size="md" variant="secondary">
                  Built-in Core
                </Button>
              ) : ext.type === 'marketplace' ? (
                <Button onClick={handleUninstall} size="md" variant="danger">
                  Uninstall
                </Button>
              ) : (
                <Button disabled size="md" variant="secondary">
                  System Module
                </Button>
              )}
            </>
          ) : (
            <Button
              onClick={handleInstall}
              disabled={installing}
              size="md"
              variant="primary"
              style={{ padding: '0 24px', height: '36px' }}
            >
              {installing ? 'Installing...' : 'Install Extension'}
            </Button>
          )}
        </div>
      </div>

      <div className="sde-ext-details-columns">
        <div className="sde-ext-details-left-col">
          <h2 className="sde-ext-details-section-title">Description</h2>
          <p className="sde-ext-details-description">
            {ext.description || 'No description provided.'}
          </p>

          <h2 className="sde-ext-details-section-title sde-ext-details-section-title--margin">README</h2>
          <div className="sde-ext-details-readme-box">
            <p style={{ margin: 0, fontWeight: 550, color: 'var(--text-primary)' }}>
              Welcome to the {ext.name} extension!
            </p>
            <p style={{ margin: 0 }}>
              This extension is seamlessly integrated into the SDE Code environment to optimize your developer workflow.
            </p>
            <div style={{ fontWeight: 600, color: 'var(--accent-cyan)', marginTop: '4px' }}>Features:</div>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {ext.provides.map((p: string) => (
                <li key={p}>Provides custom capability: <strong>{p}</strong></li>
              ))}
              {ext.type !== 'core' && (
                <li>Supports live reload and dynamic toggle switches inside the settings and marketplace.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="sde-ext-details-right-col">
          <div>
            <h3 className="sde-ext-details-meta-title">CAPABILITIES</h3>
            <div className="sde-ext-details-badge-list">
              {ext.provides.map((p: string) => (
                <span key={p} className="sde-ext-details-badge sde-ext-details-badge--cyan">{p}</span>
              ))}
            </div>
          </div>

          {ext.dependsOn && ext.dependsOn.length > 0 && (
            <div>
              <h3 className="sde-ext-details-meta-title">DEPENDENCIES</h3>
              <div className="sde-ext-details-badge-list">
                {ext.dependsOn.map((dep: string) => (
                  <span key={dep} className="sde-ext-details-badge sde-ext-details-badge--pink">{dep}</span>
                ))}
              </div>
            </div>
          )}

          {ext.categories && ext.categories.length > 0 && (
            <div>
              <h3 className="sde-ext-details-meta-title">CATEGORY</h3>
              <div className="sde-ext-details-badge-list">
                {ext.categories.map((c: string) => (
                  <span key={c} className="sde-ext-details-badge sde-ext-details-badge--cyan">{c}</span>
                ))}
              </div>
            </div>
          )}

          {ext.tags && ext.tags.length > 0 && (
            <div>
              <h3 className="sde-ext-details-meta-title">TAGS</h3>
              <div className="sde-ext-details-badge-list">
                {ext.tags.map((t: string) => (
                  <span key={t} className="sde-ext-details-badge sde-ext-details-badge--pink">{t}</span>
                ))}
              </div>
            </div>
          )}

          <div className="sde-ext-details-metadata-table">
            <h3 className="sde-ext-details-meta-title" style={{ marginBottom: '12px' }}>DETAILS</h3>
            <div className="sde-ext-details-metadata-list">
              <div className="sde-ext-details-metadata-row">
                <span style={{ color: 'var(--text-muted)' }}>Publisher</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{ext.publisher}</span>
              </div>
              <div className="sde-ext-details-metadata-row">
                <span style={{ color: 'var(--text-muted)' }}>Version</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{ext.version}</span>
              </div>
              <div className="sde-ext-details-metadata-row">
                <span style={{ color: 'var(--text-muted)' }}>Type</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'capitalize' }}>{ext.type}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
};
