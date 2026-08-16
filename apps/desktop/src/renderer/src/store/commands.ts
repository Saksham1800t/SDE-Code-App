import { create } from 'zustand';
import { Command, Keybinding, CommandsState } from '../types/commands';
import { useEditorSettingsStore } from './editorSettings';
import { useTerminalSettingsStore } from './terminalSettings';
import { useExtensionsStore } from './extensions';


export function normalizeKeyEvent(e: KeyboardEvent, platform: string): string {
  const parts: string[] = [];
  const isMac = platform === 'darwin';

  if (isMac) {
    if (e.metaKey) parts.push('Cmd');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Option');
    if (e.shiftKey) parts.push('Shift');
  } else {
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Win');
  }

  const key = e.key;
  const ignoreKeys = ['Control', 'Shift', 'Alt', 'Meta', 'Process', 'Dead'];

  if (!ignoreKeys.includes(key)) {
    let keyName = key;
    if (key === ' ') {
      keyName = 'Space';
    } else if (key === '`' || key === '~') {
      keyName = '`';
    } else if (key.length === 1) {
      keyName = key.toUpperCase();
    }
    parts.push(keyName);
  }

  return parts.join('+');
}

export const useCommandsStore = create<CommandsState>((set, get) => ({
  commands: [],
  extensionCommandIds: new Set(),
  keybindings: [],
  keybindingsMap: {},
  callbacks: {},
  platform: window.api?.platform || 'win32',
  isPaletteOpen: false,
  recentCommandIds: [],
  profiles: [],
  activeProfileId: 'default',

  initialize: async () => {
    const api = window.api;
    if (!api) return;

    try {
      const platform = api.platform || 'win32';
      const activeProfileId = get().activeProfileId;
      const dbCommands = await api.getCommands();
      const dbKeybindings = await api.getKeybindings(platform, activeProfileId);
      const dbProfiles = api.getProfiles ? await api.getProfiles().catch(() => []) : [];

      const keybindingsMap: Record<string, string> = {};
      dbKeybindings.forEach((kb: Keybinding) => {
        if (kb.key_combination && kb.key_combination.trim() !== '') {
          keybindingsMap[kb.key_combination] = kb.command_id;
        }
      });

      // Extension-contributed commands are a separate source from the core/DB list; v1 has no "contributes" title, so the palette shows the raw ID.
      let extensionCommands: Command[] = [];
      let extensionCommandIds = new Set<string>();
      if (api.getExtensionCommands) {
        try {
          const list = await api.getExtensionCommands();
          extensionCommandIds = new Set(list.map((c: { id: string }) => c.id));
          extensionCommands = list.map((c: { id: string; extensionId: string }) => ({
            id: c.id,
            name: c.id,
            category: 'Extension',
            description: `Contributed by ${c.extensionId}`,
            source: 'extension',
          }));
        } catch (err) {
          console.error('Failed to load extension commands:', err);
        }
      }

      let recentCommandIds: string[] = [];
      try {
        const settings = await api.getSettings();
        const raw = settings?.['ide-command-mru'];
        recentCommandIds = raw ? JSON.parse(raw) : [];
      } catch {
        recentCommandIds = [];
      }

      set({
        commands: [...(dbCommands || []), ...extensionCommands],
        extensionCommandIds,
        keybindings: dbKeybindings || [],
        keybindingsMap,
        platform,
        recentCommandIds,
        profiles: dbProfiles && dbProfiles.length > 0 ? dbProfiles : [{ id: 'default', name: 'Default', created_at: 0 }],
      });
    } catch (err) {
      console.error('Failed to load commands and keybindings:', err);
    }
  },

  registerCommandCallback: (commandId, cb) => {
    const current = get().callbacks;
    set({
      callbacks: {
        ...current,
        [commandId]: cb
      }
    });

    return () => {
      const updated = { ...get().callbacks };
      delete updated[commandId];
      set({ callbacks: updated });
    };
  },

  executeCommand: (commandId, ...args) => {
    const recordRecent = () => {
      const MAX_RECENT = 10;
      const next = [commandId, ...get().recentCommandIds.filter((id) => id !== commandId)].slice(0, MAX_RECENT);
      set({ recentCommandIds: next });
      window.api?.setSetting?.('ide-command-mru', JSON.stringify(next));
    };

    const cb = get().callbacks[commandId];
    if (cb) {
      try {
        cb(...args);
        recordRecent();
      } catch (err) {
        console.error(`Failed to execute command ${commandId}:`, err);
      }
      return;
    }

    if (get().extensionCommandIds.has(commandId)) {
      const api = window.api;
      if (api?.executeExtensionCommand) {
        recordRecent();
        api.executeExtensionCommand(commandId, args).catch((err: unknown) => {
          console.error(`Extension command "${commandId}" failed:`, err);
        });
      }
      return;
    }

    console.warn(`Command callback not registered for: ${commandId}`);
  },

  updateKeybinding: async (commandId, keyCombination) => {
    const api = window.api;
    if (!api) return false;

    const platform = get().platform;
    const profileId = get().activeProfileId;
    try {
      await api.setKeybinding(commandId, keyCombination, platform, profileId);
      await get().initialize();
      return true;
    } catch (err) {
      console.error('Failed to update keybinding:', err);
      return false;
    }
  },

  resetKeybindings: async () => {
    const api = window.api;
    if (!api) return;

    const platform = get().platform;
    const profileId = get().activeProfileId;
    try {
      await api.resetKeybindings(platform, profileId);
      await get().initialize();
    } catch (err) {
      console.error('Failed to reset keybindings:', err);
    }
  },

  setPaletteOpen: (open) => set({ isPaletteOpen: open }),

  setActiveProfileId: async (id) => {
    if (get().activeProfileId === id) return;
    set({ activeProfileId: id });
    await get().initialize();
    // Settings/extensions are profile-scoped too; each store reads the active profile at get/set time, so a switch just triggers their re-read.
    await Promise.all([
      useEditorSettingsStore.getState().initializeEditorSettings(),
      useTerminalSettingsStore.getState().initializeTerminalSettings(),
      useExtensionsStore.getState().initialize(),
    ]);
  },

  createProfile: async (name) => {
    const api = window.api;
    if (!api?.createProfile) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    const id = 'profile_' + Math.random().toString(36).substring(2, 11);
    try {
      const created = await api.createProfile(id, trimmed);
      if (!created) return false;
      await get().setActiveProfileId(id);
      return true;
    } catch (err) {
      console.error('Failed to create profile:', err);
      return false;
    }
  },

  renameProfile: async (id, name) => {
    const api = window.api;
    if (!api?.renameProfile) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    try {
      const renamed = await api.renameProfile(id, trimmed);
      if (renamed) {
        set({ profiles: get().profiles.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) });
      }
      return renamed;
    } catch (err) {
      console.error('Failed to rename profile:', err);
      return false;
    }
  },

  deleteProfile: async (id) => {
    const api = window.api;
    if (!api?.deleteProfile || id === 'default') return false;
    try {
      const deleted = await api.deleteProfile(id);
      if (!deleted) return false;
      set({ profiles: get().profiles.filter((p) => p.id !== id) });
      if (get().activeProfileId === id) {
        await get().setActiveProfileId('default');
      }
      return true;
    } catch (err) {
      console.error('Failed to delete profile:', err);
      return false;
    }
  },
}));
