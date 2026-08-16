import { describe, expect, it, beforeEach, vi } from 'vitest';

// terminalSettings.ts now imports commands.ts (Phase 28, to read the
// active profile) — same vi.hoisted window stub as commands.test.ts/
// editorSettings.test.ts, for the same reason (see editorSettings.test.ts's comment).
vi.hoisted(() => {
  (globalThis as any).window = { api: undefined };
});

import { useTerminalSettingsStore } from './terminalSettings';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useTerminalSettingsStore', () => {
  beforeEach(() => {
    useTerminalSettingsStore.setState(useTerminalSettingsStore.getInitialState());
    installFakeDesktopApi();
  });

  it('starts with VS Code-parity defaults', () => {
    expect(useTerminalSettingsStore.getState()).toMatchObject({ fontSize: 14, cursorStyle: 'block', cursorBlink: false, scrollback: 1000 });
  });

  it('setCursorStyle persists the raw string value', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useTerminalSettingsStore.getState().setCursorStyle('bar');

    expect(useTerminalSettingsStore.getState().cursorStyle).toBe('bar');
    expect(setSetting).toHaveBeenCalledWith('ide-terminal-cursor-style', 'bar', 'default');
  });

  it('initializeTerminalSettings rejects an invalid stored cursor style, falling back to block', async () => {
    installFakeDesktopApi({
      getSettings: vi.fn(async () => ({
        'ide-terminal-cursor-style': 'not-a-real-style',
        'ide-terminal-scrollback': '5000',
      })) as any,
    });

    await useTerminalSettingsStore.getState().initializeTerminalSettings();

    const s = useTerminalSettingsStore.getState();
    expect(s.cursorStyle).toBe('block');
    expect(s.scrollback).toBe(5000);
  });
});
