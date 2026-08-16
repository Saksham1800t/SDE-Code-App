import { create } from 'zustand';
import { useAuthStore, authenticatedFetch } from './auth';
import { useFeatureFlagsStore } from './featureFlags';
import { useExtensionsStore } from './extensions';
import { resolveServerBaseUrl } from '../../../shared/serverConfig';

/** ~500KB — over this, the user is asked to commit or stash first rather than syncing an ever-growing diff. Mirrors the server's own MAX_PENDING_DIFF_SIZE (apps/server/src/routes/sync.ts). */
const MAX_PENDING_DIFF_SIZE = 500_000;

export interface PendingChanges {
  folderKey: string;
  diff: string;
  updatedAt: string;
}

interface SyncState {
  lastSyncedAt: string | null;
  syncing: boolean;
  isSyncEnabled: boolean;
  error: string | null;

  /** A pending-changes snapshot found on the server for the CURRENT workspace, offered via a "Pending changes available" banner — never applied automatically. */
  pendingChangesAvailable: PendingChanges | null;
  pushingPendingChanges: boolean;
  applyingPendingChanges: boolean;

  initializeSync: () => void;
  toggleSyncEnabled: (enabled: boolean) => void;
  pushSettings: () => Promise<boolean>;
  pullSettings: () => Promise<boolean>;
  /** Captures the given workspace folder's full uncommitted diff (git:getWorkingTreeDiff) and syncs it — a distinct action from pushSettings, since a diff sync shouldn't require re-pushing every other setting too. */
  pushPendingChanges: (workspacePath: string) => Promise<boolean>;
  /** Silently checks whether a pending-changes snapshot exists for this workspace — call on GitPanel mount / workspace change. */
  checkPendingChanges: (workspacePath: string) => Promise<void>;
  /** Applies the currently-offered snapshot via `git apply` and clears it (locally and server-side) on success. Never called automatically. */
  applyPendingChanges: (workspacePath: string) => Promise<boolean>;
  dismissPendingChanges: (workspacePath: string) => Promise<void>;
}

const API_BASE = `${resolveServerBaseUrl(import.meta.env.VITE_SERVER_URL)}/api/sync`;

export const useSyncStore = create<SyncState>((set, get) => ({
  lastSyncedAt: null,
  syncing: false,
  isSyncEnabled: false,
  error: null,

  pendingChangesAvailable: null,
  pushingPendingChanges: false,
  applyingPendingChanges: false,

  initializeSync: () => {
    const isEnabled = localStorage.getItem('sde_sync_enabled') === 'true';
    const lastSync = localStorage.getItem('sde_last_synced_at');
    set({ isSyncEnabled: isEnabled, lastSyncedAt: lastSync });
  },

  toggleSyncEnabled: (enabled: boolean) => {
    localStorage.setItem('sde_sync_enabled', String(enabled));
    set({ isSyncEnabled: enabled });
  },

  pushSettings: async () => {
    const authStore = useAuthStore.getState();
    if (!authStore.token) {
      set({ error: 'You must be logged in to sync settings.' });
      return false;
    }

    const api = window.api;
    if (!api) return false;

    set({ syncing: true, error: null });

    try {
      // 1. Gather all settings, keybindings, and preferences from SQLite
      const settings = await api.getSettings();
      const keybindings = await api.getKeybindings(api.platform);
      // Sync/backup is a User-scope concept — pass '' so no workspace
      // override gets merged in and pushed as if it were a global value.
      const featureFlags = await api.getFlags ? await api.getFlags('') : [];
      const localExts = await api.getExtensions ? await api.getExtensions() : [];
      const enabledExtensions = localExts.filter((e: any) => e.is_enabled === 1).map((e: any) => e.id);

      const snippets: Record<string, string> = {};
      if (api.listUserSnippetFiles && api.getUserSnippetFileContent) {
        const languageIds: string[] = await api.listUserSnippetFiles();
        for (const languageId of languageIds) {
          snippets[languageId] = await api.getUserSnippetFileContent(languageId);
        }
      }

      // 2. Transmit to server
      const response = await authenticatedFetch(`${API_BASE}/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          settings,
          keybindings,
          projectRules: featureFlags,
          extensions: enabledExtensions,
          snippets
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to push configuration settings.');
      }

      const syncTime = new Date().toLocaleString();
      localStorage.setItem('sde_last_synced_at', syncTime);
      set({ syncing: false, lastSyncedAt: syncTime });
      return true;

    } catch (err: any) {
      set({ error: err.message, syncing: false });
      return false;
    }
  },

  pullSettings: async () => {
    const authStore = useAuthStore.getState();
    if (!authStore.token) {
      set({ error: 'You must be logged in to pull settings.' });
      return false;
    }

    const api = window.api;
    if (!api) return false;

    set({ syncing: true, error: null });

    try {
      // 1. Download sync profile from server
      const response = await authenticatedFetch(`${API_BASE}/pull`, {
        method: 'GET'
      });

      if (response.status === 404) {
        // No settings backed up yet
        set({ syncing: false });
        return true;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to pull settings sync profile.');
      }

      // 2. Write pulled settings to local SQLite database
      if (data.settings) {
        const settingsMap = data.settings;
        for (const [key, value] of Object.entries(settingsMap)) {
          await api.setSetting(key, String(value));
        }
      }

      if (data.keybindings && Array.isArray(data.keybindings)) {
        for (const kb of data.keybindings) {
          if (kb.command_id && kb.key_combination) {
            await api.setKeybinding(kb.command_id, kb.key_combination, api.platform);
          }
        }
      }

      if (data.extensions && Array.isArray(data.extensions)) {
        const localExts = await api.getExtensions ? await api.getExtensions() : [];
        for (const ext of localExts) {
          const shouldBeEnabled = data.extensions.includes(ext.id);
          await api.setExtensionEnabled(ext.id, shouldBeEnabled);
        }
        const extensionsStore = useExtensionsStore.getState();
        if (extensionsStore.initialize) {
          await extensionsStore.initialize();
        }
      }

      if (data.snippets && typeof data.snippets === 'object' && api.writeUserSnippetFileContent) {
        for (const [languageId, content] of Object.entries(data.snippets as Record<string, string>)) {
          await api.writeUserSnippetFileContent(languageId, content);
        }
      }

      // 3. Update React stores
      const featureFlagsStore = useFeatureFlagsStore.getState();
      if (featureFlagsStore.loadFeatureFlags) {
        featureFlagsStore.loadFeatureFlags();
      }

      const syncTime = new Date().toLocaleString();
      localStorage.setItem('sde_last_synced_at', syncTime);
      set({ syncing: false, lastSyncedAt: syncTime });
      return true;

    } catch (err: any) {
      set({ error: err.message, syncing: false });
      return false;
    }
  },

  pushPendingChanges: async (workspacePath) => {
    const authStore = useAuthStore.getState();
    if (!authStore.token) {
      set({ error: 'You must be logged in to sync pending changes.' });
      return false;
    }
    const api = window.api;
    if (!api?.gitGetWorkingTreeDiff) return false;

    set({ pushingPendingChanges: true, error: null });
    try {
      const diff = await api.gitGetWorkingTreeDiff(workspacePath);
      if (!diff.trim()) {
        set({ pushingPendingChanges: false, error: 'No uncommitted changes to sync.' });
        return false;
      }
      if (diff.length > MAX_PENDING_DIFF_SIZE) {
        set({ pushingPendingChanges: false, error: 'Too large to sync (over 500KB) — commit or stash your changes first.' });
        return false;
      }

      const response = await authenticatedFetch(`${API_BASE}/push-pending-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderKey: workspacePath, diff }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to sync pending changes.');
      }

      set({ pushingPendingChanges: false });
      return true;
    } catch (err: any) {
      set({ error: err.message, pushingPendingChanges: false });
      return false;
    }
  },

  checkPendingChanges: async (workspacePath) => {
    const authStore = useAuthStore.getState();
    if (!authStore.token || !workspacePath) {
      set({ pendingChangesAvailable: null });
      return;
    }
    try {
      const response = await authenticatedFetch(`${API_BASE}/pull`, { method: 'GET' });
      if (!response.ok) {
        set({ pendingChangesAvailable: null });
        return;
      }
      const data = await response.json();
      const entry = data.pendingChanges?.[workspacePath];
      if (entry?.diff) {
        set({ pendingChangesAvailable: { folderKey: workspacePath, diff: entry.diff, updatedAt: entry.updatedAt } });
      } else {
        set({ pendingChangesAvailable: null });
      }
    } catch (err) {
      console.error('Failed to check for pending changes:', err);
    }
  },

  applyPendingChanges: async (workspacePath) => {
    const api = window.api;
    const pending = get().pendingChangesAvailable;
    if (!api?.gitApplyWorkingTreeDiff || !pending || pending.folderKey !== workspacePath) return false;

    set({ applyingPendingChanges: true, error: null });
    try {
      const applied = await api.gitApplyWorkingTreeDiff(workspacePath, pending.diff);
      if (!applied) {
        throw new Error('These pending changes could not be applied — they may conflict with your current working tree.');
      }
      set({ applyingPendingChanges: false, pendingChangesAvailable: null });
      // Best-effort — local apply already succeeded, so a server-side clear failure just risks the banner reappearing next check.
      get().dismissPendingChanges(workspacePath).catch(() => {});
      return true;
    } catch (err: any) {
      set({ error: err.message, applyingPendingChanges: false });
      return false;
    }
  },

  dismissPendingChanges: async (workspacePath) => {
    const authStore = useAuthStore.getState();
    set({ pendingChangesAvailable: null });
    if (!authStore.token) return;
    try {
      await authenticatedFetch(`${API_BASE}/clear-pending-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderKey: workspacePath }),
      });
    } catch (err) {
      console.error('Failed to clear pending changes on server:', err);
    }
  },
}));
