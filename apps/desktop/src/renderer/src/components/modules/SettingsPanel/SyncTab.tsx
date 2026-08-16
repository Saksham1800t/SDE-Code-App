import React from 'react';
import './SettingsPanel.css';
import { Input } from '../../common/Input';
import { Button } from '../../common/Button';
import { Switch } from '../../common/Switch';
import { customConfirm } from '../../../store/confirm';
import { DIALOG_MESSAGES } from '../../../utils/dialogMessages';
import { notify } from '../../../store/notifications';

interface SyncTabProps {
  user: any;
  isAuthenticated: boolean;
  login: (email: string, pass: string) => Promise<boolean>;
  register: (user: string, email: string, pass: string) => Promise<boolean>;
  logout: () => void;
  deleteAccount: () => Promise<boolean>;
  isSyncEnabled: boolean;
  toggleSyncEnabled: (val: boolean) => void;
  pushSettings: () => Promise<boolean>;
  pullSettings: () => Promise<boolean>;
  lastSyncedAt: string | null;
  syncing: boolean;
  usernameInput: string;
  setUsernameInput: (val: string) => void;
  emailInput: string;
  setEmailInput: (val: string) => void;
  passwordInput: string;
  setPasswordInput: (val: string) => void;
  isRegisterMode: boolean;
  setIsRegisterMode: (val: boolean) => void;
}

export const SyncTab: React.FC<SyncTabProps> = ({
  user, isAuthenticated, login, register, logout, deleteAccount,
  isSyncEnabled, toggleSyncEnabled, pushSettings, pullSettings,
  lastSyncedAt, syncing,
  usernameInput, setUsernameInput,
  emailInput, setEmailInput,
  passwordInput, setPasswordInput,
  isRegisterMode, setIsRegisterMode,
}) => {
  return (
    <div className="sde-sync-tab">
      {!isAuthenticated ? (
        <div className="sde-sync-auth-card">
          <h3 className="sde-sync-auth-title">
            {isRegisterMode ? 'Create Developer Account' : 'Sign In to SDE Cloud'}
          </h3>
          <p className="sde-sync-auth-description">
            Access Settings Sync and publish private/public extensions to SDE Marketplace.
          </p>

          <div className="sde-sync-form-fields">
            {isRegisterMode && (
              <Input label="Username" type="text" value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} placeholder="sde_dev" />
            )}
            <Input label="Email Address" type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="dev@sdecode.com" />
            <Input label="Password" type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="••••••••" />

            <Button
              onClick={async () => {
                if (isRegisterMode) {
                  const ok = await register(usernameInput, emailInput, passwordInput);
                  if (ok) notify.success('Account created! Welcome.');
                } else {
                  const ok = await login(emailInput, passwordInput);
                  if (ok) notify.success('Logged in successfully.');
                }
              }}
              variant="primary"
              style={{ marginTop: '8px', height: '36px' }}
            >
              {isRegisterMode ? 'Register' : 'Log In'}
            </Button>

            <span
              className="sde-sync-toggle-link"
              onClick={() => setIsRegisterMode(!isRegisterMode)}
            >
              {isRegisterMode ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="sde-sync-user-card">
            <div className="sde-user-header-row">
              <span className="sde-sync-username">{user?.username}</span>
              <span className="sde-tag">Developer</span>
            </div>
            <span className="sde-sync-email">{user?.email}</span>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <Button onClick={() => logout()} variant="danger" size="sm">
                Log Out
              </Button>
              <Button
                onClick={async () => {
                  const confirmed = await customConfirm(DIALOG_MESSAGES.account.confirmDeleteAccount, {
                    title: 'Delete Account',
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (!confirmed) return;
                  await deleteAccount();
                }}
                variant="danger"
                size="sm"
              >
                Delete Account
              </Button>
            </div>
          </div>

          <div className="sde-sync-prefs-card">
            <h3 className="sde-sync-prefs-title">Sync Preferences</h3>

            <div className="sde-sync-toggle-row">
              <div className="sde-sync-toggle-label">
                <span className="sde-sync-toggle-name">Settings Cloud Sync</span>
                <span className="sde-sync-toggle-desc">Enable automatic configuration sync across devices</span>
              </div>
              <Switch checked={isSyncEnabled} onChange={toggleSyncEnabled} />
            </div>

            <div className="sde-sync-action-row">
              <Button onClick={async () => { const ok = await pushSettings(); if (ok) notify.success('Backup uploaded successfully!'); }} disabled={syncing} style={{ flex: 1, height: '36px' }}>
                {syncing ? 'Syncing...' : 'Backup Settings'}
              </Button>
              <Button onClick={async () => { const ok = await pullSettings(); if (ok) notify.success('Settings restored successfully! Reloading configuration...'); }} disabled={syncing} style={{ flex: 1, height: '36px' }}>
                {syncing ? 'Syncing...' : 'Restore Settings'}
              </Button>
            </div>

            {lastSyncedAt && (
              <span className="sde-sync-last-synced">Last Synced: {lastSyncedAt}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
