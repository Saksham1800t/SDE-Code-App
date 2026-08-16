import { describe, expect, it, beforeEach, vi } from 'vitest';

// extensions.ts now imports commands.ts (Phase 28, to read the active
// profile) — same vi.hoisted window stub as commands.test.ts/
// editorSettings.test.ts, for the same reason (see editorSettings.test.ts's comment).
vi.hoisted(() => {
  (globalThis as any).window = { api: undefined };
});

import { useThemeStore, getCustomThemes } from './theme';
import { useAgentStore } from './agent';
import { useExtensionsStore } from './extensions';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

// applyThemeVariables() (called by setTheme/initializeTheme) reaches into
// document.documentElement.style — there's no real DOM under vitest's Node
// environment (vitest.config.ts is deliberately DOM-free for kernel/platform
// code), so this is a hand-written fake of just the surface that's touched,
// same "no mocking library" convention as fakeDesktopApi.ts.
function installFakeDocument() {
  const setProperty = vi.fn();
  (globalThis as any).document = { documentElement: { style: { setProperty } } };
  return setProperty;
}

describe('useThemeStore', () => {
  beforeEach(() => {
    useThemeStore.setState(useThemeStore.getInitialState());
    useAgentStore.setState(useAgentStore.getInitialState());
    useExtensionsStore.setState(useExtensionsStore.getInitialState());
    installFakeDesktopApi();
    installFakeDocument();
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  });

  it('setTheme updates currentTheme, applies CSS variables, and persists the setting', () => {
    const setProperty = installFakeDocument();
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useThemeStore.getState().setTheme('dracula');

    expect(useThemeStore.getState().currentTheme).toBe('dracula');
    expect(setProperty).toHaveBeenCalledWith('--bg-primary', expect.any(String));
    expect(setSetting).toHaveBeenCalledWith('ide-theme', 'dracula');
  });

  it('loadLocalThemes maps SQLite rows into ThemeConfig objects keyed by id', async () => {
    installFakeDesktopApi({
      getThemes: vi.fn(async () => [
        { id: 'midnight', label: 'Midnight', bg_primary: '#000', bg_secondary: '#111', bg_tertiary: '#222',
          border_color: '#333', accent_color: '#444', accent_secondary: '#555', text_primary: '#fff',
          text_secondary: '#ccc', text_muted: '#999' },
      ]) as any,
    });

    await useThemeStore.getState().loadLocalThemes();

    expect(useThemeStore.getState().localThemes.midnight).toMatchObject({
      label: 'Midnight',
      bgPrimary: '#000',
      textMuted: '#999',
    });
  });

  it('loadExtensionThemes falls back to defaults for missing variables', async () => {
    installFakeDesktopApi({
      getExtensionThemes: vi.fn(async () => [
        { id: 'ext-theme', extensionId: 'demo.ext', variables: { bgPrimary: '#123456' } },
      ]) as any,
    });

    await useThemeStore.getState().loadExtensionThemes();

    const theme = useThemeStore.getState().extensionThemes['ext-theme'];
    expect(theme.bgPrimary).toBe('#123456');
    expect(theme.borderColor).toBe('#30363d'); // untouched variable falls back to the hardcoded default
  });

  it('getCustomThemes merges local and extension themes, extension wins on id collision', () => {
    useThemeStore.setState({
      localThemes: { shared: { name: 'shared', label: 'Local' } as any },
      extensionThemes: { shared: { name: 'shared', label: 'Extension' } as any, onlyExt: { name: 'onlyExt', label: 'Ext' } as any },
    });

    const merged = getCustomThemes();

    expect(merged.shared.label).toBe('Extension');
    expect(merged.onlyExt).toBeDefined();
  });

  it('initializeTheme sets AI fields via a raw setState, not setActiveAIProvider (avoids a redundant re-persist)', async () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({
      setSetting: setSetting as any,
      getSettings: vi.fn(async () => ({
        'ide-theme': 'slate',
        'ide-ai-provider': 'anthropic',
        'ide-ai-model': 'claude-opus-4-8',
        'ide-inline-completion-enabled': '0',
      })) as any,
    });
    useExtensionsStore.setState({ initialize: vi.fn(async () => {}) });

    await useThemeStore.getState().initializeTheme();

    expect(useAgentStore.getState().activeAIProvider).toBe('anthropic');
    expect(useAgentStore.getState().activeAIModel).toBe('claude-opus-4-8');
    expect(useAgentStore.getState().inlineCompletionEnabled).toBe(false);
    // The setting was only ever read, never re-written, by initializeTheme.
    expect(setSetting).not.toHaveBeenCalledWith('ide-ai-provider', 'anthropic');
  });
});
