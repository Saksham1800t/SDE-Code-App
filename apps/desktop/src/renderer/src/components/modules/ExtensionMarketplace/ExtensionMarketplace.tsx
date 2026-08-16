import React, { useEffect, useState } from 'react';
import './ExtensionMarketplace.css';
import { useExtensionsStore } from '../../../store/extensions';
import { useAuthStore } from '../../../store/auth';
import { useWorkspaceStore } from '../../../store/workspace';
import { useCommandsStore } from '../../../store/commands';
import { ExtensionCard } from './ExtensionCard';
import { Input } from '../../common/Input';
import { resolveServerBaseUrl } from '../../../../../shared/serverConfig';
import { customAlert } from '../../../store/alerts';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';

const SERVER_URL = resolveServerBaseUrl(import.meta.env.VITE_SERVER_URL);

// No per-workspace recommendations file exists here, so recommend by tag match instead.
const RECOMMENDED_TAGS = ['theme', 'productivity', 'snippets', 'formatter', 'linter', 'git'];
const isRecommendable = (ext: any) => {
  const haystack = [...(ext.categories || []), ...(ext.tags || [])].map((s: string) => s.toLowerCase());
  return RECOMMENDED_TAGS.some((tag) => haystack.includes(tag));
};

export const ExtensionMarketplace: React.FC = () => {
  const { extensions, initialize, toggleExtension, installExtension, uninstallExtension } = useExtensionsStore();
  const { isAuthenticated } = useAuthStore();
  const { openCreateExtensionTab } = useWorkspaceStore();
  const { executeCommand } = useCommandsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'recommended' | 'marketplace' | 'publish'>('installed');

  const [remoteExtensions, setRemoteExtensions] = useState<any[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);

  // Languages with configured snippets, needed as a source when publishing a snippets extension.
  const [configuredSnippetLanguages, setConfiguredSnippetLanguages] = useState<string[]>([]);
  useEffect(() => {
    if (activeTab !== 'publish') return;
    const api = window.api;
    if (!api?.listUserSnippetFiles) return;
    api.listUserSnippetFiles().then(setConfiguredSnippetLanguages).catch((err) => {
      console.error('Failed to list configured snippet languages:', err);
    });
  }, [activeTab]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (activeTab === 'marketplace' || activeTab === 'recommended') {
      fetchMarketplaceExtensions();
    }
  }, [activeTab, searchQuery]);

  const fetchMarketplaceExtensions = async () => {
    setLoadingRemote(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/extensions?query=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        setRemoteExtensions(data);
      }
    } catch (err) {
      console.error('Failed to load marketplace from backend:', err);
    } finally {
      setLoadingRemote(false);
    }
  };

  const handleToggle = async (id: string, currentlyEnabled: boolean) => {
    const res = await toggleExtension(id, !currentlyEnabled);
    if (!res.success) {
      customAlert(DIALOG_MESSAGES.extensions.toggleFailed(res.message));
    } else if (res.message) {
      customAlert(res.message);
    }
  };

  const handleInstallRemote = async (ext: any) => {
    const api = window.api;
    if (!api || !api.downloadExtension) {
      customAlert(DIALOG_MESSAGES.extensions.installerBridgeMissing);
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
      fetchMarketplaceExtensions();
    } catch (err: any) {
      customAlert(DIALOG_MESSAGES.extensions.installFailed(err));
    }
  };

  const handleUninstall = async (id: string) => {
    const res = await uninstallExtension(id);
    if (!res.success) {
      customAlert(DIALOG_MESSAGES.extensions.uninstallFailed(res.message));
    } else {
      customAlert(DIALOG_MESSAGES.extensions.uninstallSuccess);
    }
  };

  const filteredInstalled = extensions.filter(
    (e) =>
      e.type !== 'core' &&
      (e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="sde-extension-panel">
      <div className="sde-extension-header">
        <h2 className="sde-extension-title">EXTENSIONS</h2>
      </div>

      <div className="sde-extension-search-row">
        <Input
          type="text"
          placeholder="Search extensions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="sde-extension-tabs">
        <button
          onClick={() => setActiveTab('installed')}
          className={`sde-tab-nav-btn${activeTab === 'installed' ? ' active' : ''}`}
          style={{ paddingBottom: '6px', fontSize: '12px' }}
        >
          Installed ({filteredInstalled.length})
        </button>
        <button
          onClick={() => setActiveTab('recommended')}
          className={`sde-tab-nav-btn${activeTab === 'recommended' ? ' active' : ''}`}
          style={{ paddingBottom: '6px', fontSize: '12px' }}
        >
          Recommended
        </button>
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`sde-tab-nav-btn${activeTab === 'marketplace' ? ' active' : ''}`}
          style={{ paddingBottom: '6px', fontSize: '12px' }}
        >
          Marketplace
        </button>
        <button
          onClick={() => setActiveTab('publish')}
          className={`sde-tab-nav-btn${activeTab === 'publish' ? ' active' : ''}`}
          style={{ paddingBottom: '6px', fontSize: '12px' }}
        >
          Publish
        </button>
      </div>

      <div className="sde-extension-list">
        {activeTab === 'installed' && (
          filteredInstalled.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>No matching installed extensions found.</div>
          ) : (
            filteredInstalled.map((ext) => (
              <ExtensionCard
                key={ext.id}
                ext={ext}
                tab="installed"
                onToggle={handleToggle}
                onInstall={() => { }}
                onUninstall={handleUninstall}
              />
            ))
          )
        )}

        {activeTab === 'recommended' && (
          loadingRemote ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>Querying remote SDE Marketplace...</div>
          ) : (
            (() => {
              const notInstalled = remoteExtensions.filter((m) => !extensions.some((e) => e.id === m.id));
              const recommended = notInstalled.filter(isRecommendable);
              const shown = recommended.length > 0 ? recommended : notInstalled;
              return shown.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>No recommendations available right now.</div>
              ) : (
                shown.map((ext) => (
                  <ExtensionCard
                    key={ext.id}
                    ext={ext}
                    tab="marketplace"
                    onToggle={() => {}}
                    onInstall={() => handleInstallRemote(ext)}
                    onUninstall={() => {}}
                  />
                ))
              );
            })()
          )
        )}

        {activeTab === 'marketplace' && (
          loadingRemote ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>Querying remote SDE Marketplace...</div>
          ) : remoteExtensions.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>No marketplace extensions found. Use "Create Extension" to publish one!</div>
          ) : (
            remoteExtensions
              .filter(m => !extensions.some(e => e.id === m.id))
              .map((ext) => (
                <ExtensionCard
                  key={ext.id}
                  ext={ext}
                  tab="marketplace"
                  onToggle={() => { }}
                  onInstall={() => handleInstallRemote(ext)}
                  onUninstall={() => { }}
                />
              ))
          )
        )}

        {activeTab === 'publish' && (
          !isAuthenticated ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px 0' }}>
              Log in (Settings &gt; Account) to publish extensions to the marketplace.
            </div>
          ) : (
            <>
              <div className="sde-ext-card" style={{ cursor: 'default' }}>
                <div className="sde-ext-card-header">
                  <span className="sde-ext-card-name">Theme</span>
                </div>
                <p className="sde-ext-card-desc">
                  Package one of your custom color themes as an installable, shareable extension.
                </p>
                <button className="sde-extension-create-btn" onClick={() => openCreateExtensionTab()}>
                  + Publish a Theme
                </button>
              </div>

              <div className="sde-ext-card" style={{ cursor: 'default' }}>
                <div className="sde-ext-card-header">
                  <span className="sde-ext-card-name">Snippets</span>
                </div>
                <p className="sde-ext-card-desc">
                  Package your personal code snippets for a language as an installable, shareable extension.
                </p>
                {configuredSnippetLanguages.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>You haven't configured any snippets yet.</span>
                    <button className="sde-extension-create-btn" onClick={() => executeCommand('edit.configureUserSnippets')}>
                      Configure Snippets
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {configuredSnippetLanguages.map((lang) => (
                      <button
                        key={lang}
                        className="sde-wizard-pill"
                        onClick={() => openCreateExtensionTab({ templateType: 'snippets', sourceLanguageId: lang })}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
};
