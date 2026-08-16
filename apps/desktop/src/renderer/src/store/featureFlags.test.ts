import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useFeatureFlagsStore } from './featureFlags';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

const effectiveFlags = [
  { name: 'git-heatmap', description: 'Show heatmap', user_enabled: 1, workspace_enabled: null },
];

describe('useFeatureFlagsStore', () => {
  beforeEach(() => {
    useFeatureFlagsStore.setState(useFeatureFlagsStore.getInitialState());
  });

  it('loadFeatureFlags is a safe no-op when window.api is unavailable', async () => {
    (globalThis as any).window = {};
    await useFeatureFlagsStore.getState().loadFeatureFlags();
    expect(useFeatureFlagsStore.getState().featureFlags).toEqual([]);
  });

  it('loadFeatureFlags maps effective rows into userValue/workspaceValue', async () => {
    installFakeDesktopApi({ getFlags: vi.fn(async () => effectiveFlags) as any });

    await useFeatureFlagsStore.getState().loadFeatureFlags();

    expect(useFeatureFlagsStore.getState().featureFlags).toEqual([
      { name: 'git-heatmap', description: 'Show heatmap', userValue: true, workspaceValue: null },
    ]);
  });

  it('loadFeatureFlags falls back to an empty array if getFlags() returns nothing', async () => {
    installFakeDesktopApi({ getFlags: vi.fn(async () => undefined) as any });

    await useFeatureFlagsStore.getState().loadFeatureFlags();

    expect(useFeatureFlagsStore.getState().featureFlags).toEqual([]);
  });

  it('toggleFeatureFlag(name, "user") flips the User value and persists with no projectId', async () => {
    const setFlag = vi.fn(async () => {});
    installFakeDesktopApi({ getFlags: vi.fn(async () => effectiveFlags) as any, setFlag: setFlag as any });
    await useFeatureFlagsStore.getState().loadFeatureFlags();

    await useFeatureFlagsStore.getState().toggleFeatureFlag('git-heatmap', 'user');

    expect(setFlag).toHaveBeenCalledWith('git-heatmap', false, undefined);
    expect(useFeatureFlagsStore.getState().featureFlags[0].userValue).toBe(false);
  });

  it('toggleFeatureFlag(name, "workspace") sets a workspace override and persists with a projectId', async () => {
    const setFlag = vi.fn(async () => {});
    installFakeDesktopApi({ getFlags: vi.fn(async () => effectiveFlags) as any, setFlag: setFlag as any });
    await useFeatureFlagsStore.getState().loadFeatureFlags();

    await useFeatureFlagsStore.getState().toggleFeatureFlag('git-heatmap', 'workspace');

    expect(setFlag).toHaveBeenCalledWith('git-heatmap', false, 'default_proj');
    const flag = useFeatureFlagsStore.getState().featureFlags[0];
    expect(flag.workspaceValue).toBe(false);
    expect(flag.userValue).toBe(true); // untouched
  });

  it('toggleFeatureFlag is a no-op for an unknown flag name', async () => {
    const setFlag = vi.fn(async () => {});
    installFakeDesktopApi({ getFlags: vi.fn(async () => effectiveFlags) as any, setFlag: setFlag as any });
    await useFeatureFlagsStore.getState().loadFeatureFlags();

    await useFeatureFlagsStore.getState().toggleFeatureFlag('does-not-exist', 'user');

    expect(setFlag).not.toHaveBeenCalled();
  });

  it('clearWorkspaceOverride reverts workspaceValue to null and calls the IPC method', async () => {
    const clearWorkspaceFlagOverride = vi.fn(async () => {});
    installFakeDesktopApi({ getFlags: vi.fn(async () => effectiveFlags) as any, clearWorkspaceFlagOverride: clearWorkspaceFlagOverride as any });
    await useFeatureFlagsStore.getState().loadFeatureFlags();
    await useFeatureFlagsStore.getState().toggleFeatureFlag('git-heatmap', 'workspace');

    await useFeatureFlagsStore.getState().clearWorkspaceOverride('git-heatmap');

    expect(clearWorkspaceFlagOverride).toHaveBeenCalledWith('git-heatmap', 'default_proj');
    expect(useFeatureFlagsStore.getState().featureFlags[0].workspaceValue).toBeNull();
  });

  it('isFlagEnabled returns the workspace override when present, else the User value', async () => {
    installFakeDesktopApi({
      getFlags: vi.fn(async () => [
        { name: 'a', description: '', user_enabled: 1, workspace_enabled: 0 },
        { name: 'b', description: '', user_enabled: 0, workspace_enabled: null },
      ]) as any,
    });
    await useFeatureFlagsStore.getState().loadFeatureFlags();

    expect(useFeatureFlagsStore.getState().isFlagEnabled('a')).toBe(false); // workspace override wins
    expect(useFeatureFlagsStore.getState().isFlagEnabled('b')).toBe(false); // inherits User value
    expect(useFeatureFlagsStore.getState().isFlagEnabled('unknown')).toBe(false);
  });
});
