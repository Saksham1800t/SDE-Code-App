import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useTerminalStore } from './terminal';
import { useWorkspaceStore } from './workspace';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useTerminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState(useTerminalStore.getInitialState());
    useWorkspaceStore.setState({ workspacePath: null });
    installFakeDesktopApi();
  });

  it('createNewTerminal adds a terminal, makes it active, and opens the panel', () => {
    useTerminalStore.getState().createNewTerminal();

    const state = useTerminalStore.getState();
    expect(state.terminals).toHaveLength(1);
    expect(state.activeTerminalId).toBe(state.terminals[0].id);
    expect(state.isTerminalOpen).toBe(true);
  });

  it('createNewTerminal names terminals sequentially and forwards the workspace path', () => {
    useWorkspaceStore.setState({ workspacePath: '/repo' });
    const createTerminal = vi.fn(async () => {});
    installFakeDesktopApi({ createTerminal: createTerminal as any });

    useTerminalStore.getState().createNewTerminal();
    useTerminalStore.getState().createNewTerminal();

    const { terminals } = useTerminalStore.getState();
    expect(terminals[0].name).toBe('1: powershell');
    expect(terminals[1].name).toBe('2: powershell');
    expect(createTerminal).toHaveBeenLastCalledWith(terminals[1].id, '/repo', []);
  });

  it('closeTerminal removes the terminal and falls back to the previous one when the active terminal is closed', () => {
    useTerminalStore.getState().createNewTerminal();
    useTerminalStore.getState().createNewTerminal();
    const [first, second] = useTerminalStore.getState().terminals;

    useTerminalStore.getState().closeTerminal(second.id);

    const state = useTerminalStore.getState();
    expect(state.terminals).toEqual([first]);
    expect(state.activeTerminalId).toBe(first.id);
    expect(state.isTerminalOpen).toBe(true);
  });

  it('closeTerminal closes the panel once the last terminal is closed', () => {
    useTerminalStore.getState().createNewTerminal();
    const [only] = useTerminalStore.getState().terminals;

    useTerminalStore.getState().closeTerminal(only.id);

    const state = useTerminalStore.getState();
    expect(state.terminals).toEqual([]);
    expect(state.activeTerminalId).toBeNull();
    expect(state.isTerminalOpen).toBe(false);
  });

  it('setActiveTerminal switches the active id without touching the terminal list', () => {
    useTerminalStore.getState().createNewTerminal();
    useTerminalStore.getState().createNewTerminal();
    const [first] = useTerminalStore.getState().terminals;

    useTerminalStore.getState().setActiveTerminal(first.id);

    expect(useTerminalStore.getState().activeTerminalId).toBe(first.id);
    expect(useTerminalStore.getState().terminals).toHaveLength(2);
  });

  it('renameTerminal updates only the target terminal\'s name', () => {
    useTerminalStore.getState().createNewTerminal();
    useTerminalStore.getState().createNewTerminal();
    const [first, second] = useTerminalStore.getState().terminals;

    useTerminalStore.getState().renameTerminal(first.id, 'build watcher');

    const { terminals } = useTerminalStore.getState();
    expect(terminals[0].name).toBe('build watcher');
    expect(terminals[1].name).toBe(second.name);
  });

  it('renameTerminal ignores a blank/whitespace-only name', () => {
    useTerminalStore.getState().createNewTerminal();
    const [only] = useTerminalStore.getState().terminals;

    useTerminalStore.getState().renameTerminal(only.id, '   ');

    expect(useTerminalStore.getState().terminals[0].name).toBe(only.name);
  });

  it('closeAllTerminals closes every session via the api and clears state', () => {
    const closeTerminal = vi.fn(async () => {});
    installFakeDesktopApi({ closeTerminal: closeTerminal as any });
    useTerminalStore.getState().createNewTerminal();
    useTerminalStore.getState().createNewTerminal();

    useTerminalStore.getState().closeAllTerminals();

    expect(closeTerminal).toHaveBeenCalledTimes(2);
    const state = useTerminalStore.getState();
    expect(state.terminals).toEqual([]);
    expect(state.activeTerminalId).toBeNull();
  });
});
