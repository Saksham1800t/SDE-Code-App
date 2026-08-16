import { describe, expect, it, beforeEach, vi } from 'vitest';

// commands.ts's store initializer reads `window.api?.platform` at MODULE
// LOAD time (not lazily inside an action) — under vitest's 'node'
// environment there's no `window` at all until installFakeDesktopApi()
// creates one, but by ordinary import-hoisting rules that runs too late
// (all of a test file's imports are evaluated, including commands.ts's own
// top-level store creation, before any of the test file's own code — even
// code textually above the import — ever runs). vi.hoisted() is Vitest's
// documented escape hatch for exactly this: it runs before every import.
vi.hoisted(() => {
  (globalThis as any).window = { api: undefined };
});

import { useCommandsStore } from './commands';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useCommandsStore — keybinding profiles', () => {
  beforeEach(() => {
    useCommandsStore.setState(useCommandsStore.getInitialState());
    installFakeDesktopApi();
  });

  it('initialize() loads profiles and defaults activeProfileId to "default"', async () => {
    installFakeDesktopApi({
      getProfiles: vi.fn(async () => [
        { id: 'default', name: 'Default', created_at: 0 },
        { id: 'profile_abc', name: 'Vim-like', created_at: 100 },
      ]),
    });

    await useCommandsStore.getState().initialize();

    const state = useCommandsStore.getState();
    expect(state.activeProfileId).toBe('default');
    expect(state.profiles.map((p) => p.id)).toEqual(['default', 'profile_abc']);
  });

  it('initialize() falls back to a synthetic "Default" profile entry if getProfiles returns nothing', async () => {
    installFakeDesktopApi({ getProfiles: vi.fn(async () => []) });

    await useCommandsStore.getState().initialize();

    expect(useCommandsStore.getState().profiles).toEqual([{ id: 'default', name: 'Default', created_at: 0 }]);
  });

  it('updateKeybinding sends the currently-active profile id, not a hardcoded "default"', async () => {
    const setKeybinding = vi.fn(async () => true);
    installFakeDesktopApi({ setKeybinding });
    useCommandsStore.setState({ activeProfileId: 'profile_abc' });

    await useCommandsStore.getState().updateKeybinding('file.saveFile', 'Ctrl+S');

    expect(setKeybinding).toHaveBeenCalledWith('file.saveFile', 'Ctrl+S', 'win32', 'profile_abc');
  });

  it('resetKeybindings sends the currently-active profile id', async () => {
    const resetKeybindings = vi.fn(async () => true);
    installFakeDesktopApi({ resetKeybindings });
    useCommandsStore.setState({ activeProfileId: 'profile_abc' });

    await useCommandsStore.getState().resetKeybindings();

    expect(resetKeybindings).toHaveBeenCalledWith('win32', 'profile_abc');
  });

  it('setActiveProfileId switches the profile and reloads keybindings scoped to it', async () => {
    const getKeybindings = vi.fn(async (_platform: string, profileId?: string) =>
      profileId === 'profile_abc' ? [{ command_id: 'file.saveFile', key_combination: 'Ctrl+Alt+S', platform: 'win32', profile_id: 'profile_abc' }] : [],
    );
    installFakeDesktopApi({ getKeybindings });

    await useCommandsStore.getState().setActiveProfileId('profile_abc');

    expect(useCommandsStore.getState().activeProfileId).toBe('profile_abc');
    expect(getKeybindings).toHaveBeenLastCalledWith('win32', 'profile_abc');
    expect(useCommandsStore.getState().keybindingsMap['Ctrl+Alt+S']).toBe('file.saveFile');
  });

  it('setActiveProfileId is a no-op when switching to the already-active profile', async () => {
    const getKeybindings = vi.fn(async () => []);
    installFakeDesktopApi({ getKeybindings });

    await useCommandsStore.getState().setActiveProfileId('default');

    expect(getKeybindings).not.toHaveBeenCalled();
  });

  it('createProfile creates via the API and auto-switches to the new profile on success', async () => {
    const createProfile = vi.fn(async (_id: string, _name: string) => true);
    const getKeybindings = vi.fn(async () => []);
    installFakeDesktopApi({ createProfile, getKeybindings });

    const ok = await useCommandsStore.getState().createProfile('My Profile');

    expect(ok).toBe(true);
    expect(createProfile).toHaveBeenCalledTimes(1);
    const [calledId, calledName] = createProfile.mock.calls[0];
    expect(calledName).toBe('My Profile');
    expect(typeof calledId).toBe('string');
    expect(useCommandsStore.getState().activeProfileId).toBe(calledId);
  });

  it('createProfile rejects an empty/whitespace name without calling the API', async () => {
    const createProfile = vi.fn(async () => true);
    installFakeDesktopApi({ createProfile });

    const ok = await useCommandsStore.getState().createProfile('   ');

    expect(ok).toBe(false);
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('renameProfile updates the local profiles list on success', async () => {
    useCommandsStore.setState({ profiles: [{ id: 'profile_abc', name: 'Old Name', created_at: 0 }] });
    installFakeDesktopApi({ renameProfile: vi.fn(async () => true) });

    const ok = await useCommandsStore.getState().renameProfile('profile_abc', 'New Name');

    expect(ok).toBe(true);
    expect(useCommandsStore.getState().profiles[0].name).toBe('New Name');
  });

  it('deleteProfile refuses to delete "default" without calling the API', async () => {
    const deleteProfile = vi.fn(async () => true);
    installFakeDesktopApi({ deleteProfile });

    const ok = await useCommandsStore.getState().deleteProfile('default');

    expect(ok).toBe(false);
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it('deleteProfile removes the profile from the local list and falls back to "default" if it was active', async () => {
    useCommandsStore.setState({
      profiles: [{ id: 'default', name: 'Default', created_at: 0 }, { id: 'profile_abc', name: 'Vim-like', created_at: 100 }],
      activeProfileId: 'profile_abc',
    });
    const getKeybindings = vi.fn(async () => []);
    installFakeDesktopApi({ deleteProfile: vi.fn(async () => true), getKeybindings });

    const ok = await useCommandsStore.getState().deleteProfile('profile_abc');

    expect(ok).toBe(true);
    expect(useCommandsStore.getState().profiles.map((p) => p.id)).toEqual(['default']);
    expect(useCommandsStore.getState().activeProfileId).toBe('default');
  });

  it('deleteProfile leaves activeProfileId untouched when deleting a non-active profile', async () => {
    useCommandsStore.setState({
      profiles: [{ id: 'default', name: 'Default', created_at: 0 }, { id: 'profile_abc', name: 'Vim-like', created_at: 100 }],
      activeProfileId: 'default',
    });
    installFakeDesktopApi({ deleteProfile: vi.fn(async () => true) });

    await useCommandsStore.getState().deleteProfile('profile_abc');

    expect(useCommandsStore.getState().activeProfileId).toBe('default');
  });
});
