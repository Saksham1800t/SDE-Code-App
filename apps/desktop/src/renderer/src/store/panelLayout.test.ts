import { describe, expect, it, beforeEach, vi } from 'vitest';
import { usePanelLayoutStore } from './panelLayout';
import { useTerminalStore } from './terminal';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('usePanelLayoutStore', () => {
  beforeEach(() => {
    usePanelLayoutStore.setState(usePanelLayoutStore.getInitialState());
    useTerminalStore.setState(useTerminalStore.getInitialState());
    installFakeDesktopApi();
  });

  it('starts with the explorer tab active and the left sidebar open', () => {
    const state = usePanelLayoutStore.getState();
    expect(state.activeSidebarTab).toBe('explorer');
    expect(state.isLeftSidebarOpen).toBe(true);
    expect(state.isRightSidebarOpen).toBe(false);
  });

  it('setSidebarTab switches the active tab', () => {
    usePanelLayoutStore.getState().setSidebarTab('git');
    expect(usePanelLayoutStore.getState().activeSidebarTab).toBe('git');
  });

  it('toggleLeftSidebar flips state when called with no argument', () => {
    usePanelLayoutStore.getState().toggleLeftSidebar();
    expect(usePanelLayoutStore.getState().isLeftSidebarOpen).toBe(false);

    usePanelLayoutStore.getState().toggleLeftSidebar();
    expect(usePanelLayoutStore.getState().isLeftSidebarOpen).toBe(true);
  });

  it('toggleLeftSidebar forces the given state when an argument is passed', () => {
    usePanelLayoutStore.getState().toggleLeftSidebar(true);
    expect(usePanelLayoutStore.getState().isLeftSidebarOpen).toBe(true);

    usePanelLayoutStore.getState().toggleLeftSidebar(true);
    expect(usePanelLayoutStore.getState().isLeftSidebarOpen).toBe(true);
  });

  it('toggleRightSidebar flips independently of the left sidebar', () => {
    usePanelLayoutStore.getState().toggleRightSidebar();
    expect(usePanelLayoutStore.getState().isRightSidebarOpen).toBe(true);
    expect(usePanelLayoutStore.getState().isLeftSidebarOpen).toBe(true);
  });

  it('setLeftSidebarWidth/setRightSidebarWidth/setTerminalHeight store the given values', () => {
    usePanelLayoutStore.getState().setLeftSidebarWidth(300);
    usePanelLayoutStore.getState().setRightSidebarWidth(400);
    usePanelLayoutStore.getState().setTerminalHeight(500);

    const state = usePanelLayoutStore.getState();
    expect(state.leftSidebarWidth).toBe(300);
    expect(state.rightSidebarWidth).toBe(400);
    expect(state.terminalHeight).toBe(500);
  });

  it('setTerminalHeight persists the value', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    usePanelLayoutStore.getState().setTerminalHeight(321);

    expect(setSetting).toHaveBeenCalledWith('ide-panel-height', '321');
  });

  it('togglePanelMaximized caches the current height and hides the editor semantics flag', () => {
    usePanelLayoutStore.setState({ terminalHeight: 275 });

    usePanelLayoutStore.getState().togglePanelMaximized();

    const state = usePanelLayoutStore.getState();
    expect(state.isPanelMaximized).toBe(true);
    expect(state.lastNonMaximizedHeight).toBe(275);
  });

  it('togglePanelMaximized(false) restores the cached pre-maximize height', () => {
    usePanelLayoutStore.setState({ terminalHeight: 275 });
    usePanelLayoutStore.getState().togglePanelMaximized(true);

    usePanelLayoutStore.setState({ terminalHeight: 999 }); // simulate a resize while maximized shouldn't happen, but restore should still use the cache
    usePanelLayoutStore.getState().togglePanelMaximized(false);

    const state = usePanelLayoutStore.getState();
    expect(state.isPanelMaximized).toBe(false);
    expect(state.terminalHeight).toBe(275);
  });

  it('togglePanelMaximized only persists "was maximized" when remember mode is on', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    usePanelLayoutStore.setState({ panelMaximizeRemember: 'never' });
    usePanelLayoutStore.getState().togglePanelMaximized(true);
    expect(setSetting).not.toHaveBeenCalledWith('ide-panel-was-maximized', '1');

    usePanelLayoutStore.setState({ panelMaximizeRemember: 'remember', isPanelMaximized: false });
    usePanelLayoutStore.getState().togglePanelMaximized(true);
    expect(setSetting).toHaveBeenCalledWith('ide-panel-was-maximized', '1');
  });

  it('setPanelPosition stores and persists the position', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    usePanelLayoutStore.getState().setPanelPosition('left');

    expect(usePanelLayoutStore.getState().panelPosition).toBe('left');
    expect(setSetting).toHaveBeenCalledWith('ide-panel-position', 'left');
  });

  it('initializePanelLayout reads persisted height/remember-mode from settings', async () => {
    installFakeDesktopApi({
      getSettings: vi.fn(async () => ({
        'ide-panel-height': '333',
        'ide-panel-last-height': '444',
        'ide-panel-maximize-remember': 'remember',
        'ide-panel-was-maximized': '1',
      })) as any,
    });

    await usePanelLayoutStore.getState().initializePanelLayout();

    const state = usePanelLayoutStore.getState();
    expect(state.terminalHeight).toBe(333);
    expect(state.lastNonMaximizedHeight).toBe(444);
    expect(state.panelMaximizeRemember).toBe('remember');
    expect(state.isPanelMaximized).toBe(true); // remembered as maximized last session
  });

  it('initializePanelLayout does not start maximized when remember mode is "never"', async () => {
    installFakeDesktopApi({
      getSettings: vi.fn(async () => ({
        'ide-panel-maximize-remember': 'never',
        'ide-panel-was-maximized': '1', // stale/irrelevant when remember is off
      })) as any,
    });

    await usePanelLayoutStore.getState().initializePanelLayout();

    expect(usePanelLayoutStore.getState().isPanelMaximized).toBe(false);
  });

  describe('toggleZenMode', () => {
    it('entering hides both sidebars and the terminal panel', () => {
      usePanelLayoutStore.setState({ isLeftSidebarOpen: true, isRightSidebarOpen: true });
      useTerminalStore.setState({ isTerminalOpen: true });

      usePanelLayoutStore.getState().toggleZenMode();

      const state = usePanelLayoutStore.getState();
      expect(state.isZenMode).toBe(true);
      expect(state.isLeftSidebarOpen).toBe(false);
      expect(state.isRightSidebarOpen).toBe(false);
      expect(useTerminalStore.getState().isTerminalOpen).toBe(false);
    });

    it('exiting restores exactly what was open before, not just "everything on"', () => {
      // Only the left sidebar and no terminal, going in — exiting should
      // reproduce that exact combination, not the store's plain defaults.
      usePanelLayoutStore.setState({ isLeftSidebarOpen: true, isRightSidebarOpen: false });
      useTerminalStore.setState({ isTerminalOpen: false });

      usePanelLayoutStore.getState().toggleZenMode(true);
      usePanelLayoutStore.getState().toggleZenMode(false);

      const state = usePanelLayoutStore.getState();
      expect(state.isZenMode).toBe(false);
      expect(state.isLeftSidebarOpen).toBe(true);
      expect(state.isRightSidebarOpen).toBe(false);
      expect(useTerminalStore.getState().isTerminalOpen).toBe(false);
      expect(state.preZenModeState).toBeNull();
    });

    it('restores the right sidebar and terminal too when they were open going in', () => {
      usePanelLayoutStore.setState({ isLeftSidebarOpen: false, isRightSidebarOpen: true });
      useTerminalStore.setState({ isTerminalOpen: true });

      usePanelLayoutStore.getState().toggleZenMode(true);
      usePanelLayoutStore.getState().toggleZenMode(false);

      const state = usePanelLayoutStore.getState();
      expect(state.isLeftSidebarOpen).toBe(false);
      expect(state.isRightSidebarOpen).toBe(true);
      expect(useTerminalStore.getState().isTerminalOpen).toBe(true);
    });

    it('toggling to the state it is already in is a no-op', () => {
      usePanelLayoutStore.setState({ isLeftSidebarOpen: true, isRightSidebarOpen: false, isZenMode: false });

      usePanelLayoutStore.getState().toggleZenMode(false);

      const state = usePanelLayoutStore.getState();
      expect(state.isZenMode).toBe(false);
      expect(state.preZenModeState).toBeNull();
      expect(state.isLeftSidebarOpen).toBe(true); // untouched, not reset
    });

    it('with no argument, flips the current state', () => {
      expect(usePanelLayoutStore.getState().isZenMode).toBe(false);
      usePanelLayoutStore.getState().toggleZenMode();
      expect(usePanelLayoutStore.getState().isZenMode).toBe(true);
      usePanelLayoutStore.getState().toggleZenMode();
      expect(usePanelLayoutStore.getState().isZenMode).toBe(false);
    });
  });
});
