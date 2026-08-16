import { describe, expect, it, beforeEach, vi } from 'vitest';

// editorSettings.ts now imports commands.ts (Phase 28, to read the active
// profile) — whose store initializer reads `window.api?.platform` at
// MODULE LOAD time. Same fix as commands.test.ts's own vi.hoisted guard:
// under vitest's 'node' environment there's no `window` until
// installFakeDesktopApi() creates one, which runs too late relative to
// import-hoisting (all imports evaluate before any of a test file's own
// code, even code textually above the import statement).
vi.hoisted(() => {
  (globalThis as any).window = { api: undefined };
});

import { useEditorSettingsStore } from './editorSettings';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useEditorSettingsStore', () => {
  beforeEach(() => {
    useEditorSettingsStore.setState(useEditorSettingsStore.getInitialState());
    installFakeDesktopApi();
  });

  it('starts with VS Code-parity defaults', () => {
    const s = useEditorSettingsStore.getState();
    expect(s).toMatchObject({ fontSize: 14, tabSize: 2, wordWrap: 'on', minimapEnabled: true, lineNumbers: 'on', showBreadcrumbs: true, inlayHintsEnabled: false });
  });

  it('setFontSize/setTabSize persist as numeric strings', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useEditorSettingsStore.getState().setFontSize(18);
    useEditorSettingsStore.getState().setTabSize(4);

    expect(useEditorSettingsStore.getState().fontSize).toBe(18);
    expect(setSetting).toHaveBeenCalledWith('ide-editor-font-size', '18', 'default');
    expect(setSetting).toHaveBeenCalledWith('ide-editor-tab-size', '4', 'default');
  });

  it('boolean setters persist as 0/1 strings', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useEditorSettingsStore.getState().setMinimapEnabled(false);
    useEditorSettingsStore.getState().setShowBreadcrumbs(false);
    useEditorSettingsStore.getState().setInlayHintsEnabled(true);

    expect(setSetting).toHaveBeenCalledWith('ide-editor-minimap', '0', 'default');
    expect(setSetting).toHaveBeenCalledWith('ide-editor-breadcrumbs', '0', 'default');
    expect(setSetting).toHaveBeenCalledWith('ide-editor-inlay-hints', '1', 'default');
    expect(useEditorSettingsStore.getState().inlayHintsEnabled).toBe(true);
  });

  it('initializeEditorSettings reads persisted values, defaulting sensibly when absent', async () => {
    installFakeDesktopApi({
      getSettings: vi.fn(async () => ({
        'ide-editor-font-size': '20',
        'ide-editor-word-wrap': 'off',
        'ide-editor-minimap': '0',
        'ide-editor-inlay-hints': '1',
      })) as any,
    });

    await useEditorSettingsStore.getState().initializeEditorSettings();

    const s = useEditorSettingsStore.getState();
    expect(s.fontSize).toBe(20);
    expect(s.wordWrap).toBe('off');
    expect(s.minimapEnabled).toBe(false);
    expect(s.tabSize).toBe(2); // untouched key falls back to default
    expect(s.showBreadcrumbs).toBe(true); // untouched key falls back to default
    expect(s.inlayHintsEnabled).toBe(true);
  });

  it('initializeEditorSettings defaults inlayHintsEnabled to false when unset', async () => {
    await useEditorSettingsStore.getState().initializeEditorSettings();
    expect(useEditorSettingsStore.getState().inlayHintsEnabled).toBe(false);
  });
});
