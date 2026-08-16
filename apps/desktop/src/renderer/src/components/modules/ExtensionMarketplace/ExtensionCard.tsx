import React from 'react';
import './ExtensionMarketplace.css';
import { Switch } from '../../common/Switch';
import { Button } from '../../common/Button';
import { useWorkspaceStore } from '../../../store/workspace';
import { useExtensionsStore } from '../../../store/extensions';
import { ExtensionIcon } from './ExtensionIcon';

export interface Extension {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  type: 'core' | 'system' | 'marketplace';
  provides: string[];
  dependsOn?: string[];
  categories?: string[];
  tags?: string[];
  isEnabled: boolean;
}

interface ExtensionCardProps {
  ext: any;
  tab: 'installed' | 'marketplace';
  onToggle: (id: string, currentlyEnabled: boolean) => void;
  onInstall: () => void;
  onUninstall: (id: string) => void;
}

export const ExtensionCard: React.FC<ExtensionCardProps> = ({
  ext,
  tab,
  onToggle,
  onInstall,
  onUninstall,
}) => {
  const isInstalledTab = tab === 'installed';
  const { openExtensionDetailsTab, workspacePath } = useWorkspaceStore();
  const { workspaceOverrides, isEffectivelyEnabled, toggleWorkspaceOverride, clearWorkspaceOverride } = useExtensionsStore();
  const hasWorkspaceOverride = workspacePath && workspaceOverrides[ext.id] !== undefined;

  return (
    <div
      onClick={() => openExtensionDetailsTab(ext.id, ext.name)}
      className="sde-ext-card"
    >
      <div className="sde-ext-card-header">
        <div className="sde-ext-card-title-group">
          <ExtensionIcon seed={ext.id} size={20} />
          <span className="sde-ext-card-name">{ext.name}</span>
          {isInstalledTab && (
            <span className={`sde-ext-card-type-tag sde-ext-card-type-tag--${ext.type}`}>{ext.type}</span>
          )}
          {ext.categories && ext.categories.length > 0 && (
            <span className="sde-ext-card-type-tag">{ext.categories[0]}</span>
          )}
        </div>

        {isInstalledTab ? (
          ext.type !== 'core' && (
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {hasWorkspaceOverride && (
                <button
                  className="sde-ghost-btn"
                  title="This workspace overrides the global setting — click to reset"
                  onClick={() => clearWorkspaceOverride(ext.id)}
                  style={{ fontSize: '10px' }}
                >
                  workspace ↺
                </button>
              )}
              <div title={workspacePath ? 'Toggles for this workspace only' : 'Toggles globally (no workspace open)'}>
                <Switch
                  size="sm"
                  checked={workspacePath ? isEffectivelyEnabled(ext.id) : ext.isEnabled}
                  onChange={() => (workspacePath ? toggleWorkspaceOverride(ext.id) : onToggle(ext.id, ext.isEnabled))}
                />
              </div>
            </div>
          )
        ) : (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
            size="sm"
            variant="primary"
          >
            Install
          </Button>
        )}
      </div>

      <p className="sde-ext-card-desc">{ext.description}</p>
      
      <div className="sde-ext-card-footer">
        <span className="sde-ext-card-meta">v{ext.version} by {ext.publisher}</span>
        {isInstalledTab && ext.type === 'marketplace' && (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onUninstall(ext.id);
            }}
            size="sm"
            variant="danger"
          >
            Uninstall
          </Button>
        )}
      </div>
    </div>
  );
};
