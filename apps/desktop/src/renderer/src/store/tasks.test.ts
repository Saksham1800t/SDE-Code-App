import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useTasksStore, ensureTasksLoadedThenAlertIfEmpty } from './tasks';
import { useWorkspaceStore } from './workspace';
import { useTerminalStore } from './terminal';
import { useProblemsStore } from './problems';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

const sampleTask = { id: 't1', name: 'Build', command: 'npm run build', problemMatcher: 'none' as const };

describe('useTasksStore', () => {
  beforeEach(() => {
    useTasksStore.setState(useTasksStore.getInitialState());
    useTerminalStore.setState(useTerminalStore.getInitialState());
    useProblemsStore.setState(useProblemsStore.getInitialState());
    useWorkspaceStore.setState({ workspaceFolders: [{ path: '/repo', name: 'repo' }], activeFolderPath: '/repo' });
    installFakeDesktopApi();
  });

  describe('loadTasks', () => {
    it('parses a valid .sde/tasks.json from the active workspace folder', async () => {
      const readFile = vi.fn(async (path: string) => {
        expect(path).toBe('/repo/.sde/tasks.json');
        return JSON.stringify([sampleTask]);
      });
      installFakeDesktopApi({ readFile: readFile as any });

      await useTasksStore.getState().loadTasks();

      expect(useTasksStore.getState().tasks).toEqual([sampleTask]);
    });

    it('falls back to an empty list when the file does not exist', async () => {
      installFakeDesktopApi({ readFile: vi.fn(async () => { throw new Error('ENOENT'); }) as any });

      await useTasksStore.getState().loadTasks();

      expect(useTasksStore.getState().tasks).toEqual([]);
    });

    it('falls back to an empty list on invalid JSON', async () => {
      installFakeDesktopApi({ readFile: vi.fn(async () => 'not json') as any });

      await useTasksStore.getState().loadTasks();

      expect(useTasksStore.getState().tasks).toEqual([]);
    });

    it('falls back to an empty list when the JSON is not an array', async () => {
      installFakeDesktopApi({ readFile: vi.fn(async () => JSON.stringify({ not: 'an array' })) as any });

      await useTasksStore.getState().loadTasks();

      expect(useTasksStore.getState().tasks).toEqual([]);
    });
  });

  describe('runTask', () => {
    it('creates a terminal at the workspace folder root when the task has no cwd', () => {
      const createTerminal = vi.fn(async () => {});
      installFakeDesktopApi({ createTerminal: createTerminal as any });

      useTasksStore.getState().runTask(sampleTask);

      expect(createTerminal).toHaveBeenCalledWith(expect.any(String), '/repo', expect.any(Array));
    });

    it("joins the task's cwd onto the workspace folder", () => {
      const createTerminal = vi.fn(async () => {});
      installFakeDesktopApi({ createTerminal: createTerminal as any });

      useTasksStore.getState().runTask({ ...sampleTask, cwd: 'packages/app' });

      expect(createTerminal).toHaveBeenCalledWith(expect.any(String), '/repo/packages/app', expect.any(Array));
    });

    it('writes the task command followed by Enter to the new terminal, after the startup delay', async () => {
      const writeTerminal = vi.fn();
      installFakeDesktopApi({ writeTerminal: writeTerminal as any });

      useTasksStore.getState().runTask(sampleTask);
      const terminalId = useTerminalStore.getState().activeTerminalId;

      expect(writeTerminal).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 450));

      expect(writeTerminal).toHaveBeenCalledWith(terminalId, 'npm run build\r');
    });

    it("does not subscribe to terminal output when problemMatcher is 'none'", () => {
      const onTerminalOutput = vi.fn(() => () => {});
      installFakeDesktopApi({ onTerminalOutput: onTerminalOutput as any });

      useTasksStore.getState().runTask(sampleTask);

      expect(onTerminalOutput).not.toHaveBeenCalled();
    });

    it('matches tsc-shaped output for the active task terminal and populates taskProblems', () => {
      let emit: ((eventData: { terminalId: string; data: string }) => void) | undefined;
      const onTerminalOutput = vi.fn((cb: any) => {
        emit = cb;
        return () => {};
      });
      installFakeDesktopApi({ onTerminalOutput: onTerminalOutput as any });

      useTasksStore.getState().runTask({ ...sampleTask, problemMatcher: 'tsc' });
      const terminalId = useTerminalStore.getState().activeTerminalId!;

      emit?.({ terminalId, data: 'src/a.ts(1,1): error TS1: bad\r\n' });

      expect(useProblemsStore.getState().taskProblems).toHaveLength(1);
      expect(useProblemsStore.getState().taskProblems[0].filePath).toBe('/repo/src/a.ts');
    });

    it('ignores output from a terminal other than the current task run', () => {
      let emit: ((eventData: { terminalId: string; data: string }) => void) | undefined;
      const onTerminalOutput = vi.fn((cb: any) => {
        emit = cb;
        return () => {};
      });
      installFakeDesktopApi({ onTerminalOutput: onTerminalOutput as any });

      useTasksStore.getState().runTask({ ...sampleTask, problemMatcher: 'tsc' });

      emit?.({ terminalId: 'some-unrelated-terminal', data: 'src/a.ts(1,1): error TS1: bad\r\n' });

      expect(useProblemsStore.getState().taskProblems).toEqual([]);
    });

    it('clears the previous run\'s taskProblems when a new task starts', () => {
      let emit: ((eventData: { terminalId: string; data: string }) => void) | undefined;
      const onTerminalOutput = vi.fn((cb: any) => {
        emit = cb;
        return () => {};
      });
      installFakeDesktopApi({ onTerminalOutput: onTerminalOutput as any });

      useTasksStore.getState().runTask({ ...sampleTask, problemMatcher: 'tsc' });
      const firstTerminalId = useTerminalStore.getState().activeTerminalId!;
      emit?.({ terminalId: firstTerminalId, data: 'src/a.ts(1,1): error TS1: bad\r\n' });
      expect(useProblemsStore.getState().taskProblems).toHaveLength(1);

      useTasksStore.getState().runTask({ ...sampleTask, problemMatcher: 'none' });

      expect(useProblemsStore.getState().taskProblems).toEqual([]);
    });
  });
});

describe('ensureTasksLoadedThenAlertIfEmpty', () => {
  beforeEach(() => {
    useTasksStore.setState(useTasksStore.getInitialState());
    useWorkspaceStore.setState({ workspaceFolders: [{ path: '/repo', name: 'repo' }], activeFolderPath: '/repo' });
    installFakeDesktopApi();
  });

  it('calls onReady without alerting when tasks exist', async () => {
    installFakeDesktopApi({ readFile: vi.fn(async () => JSON.stringify([sampleTask])) as any });
    const onReady = vi.fn();

    ensureTasksLoadedThenAlertIfEmpty(onReady);
    await new Promise((r) => setTimeout(r, 0));

    expect(onReady).toHaveBeenCalled();
  });

  it('does not call onReady when no tasks are configured', async () => {
    installFakeDesktopApi({ readFile: vi.fn(async () => { throw new Error('ENOENT'); }) as any });
    const onReady = vi.fn();

    ensureTasksLoadedThenAlertIfEmpty(onReady);
    await new Promise((r) => setTimeout(r, 0));

    expect(onReady).not.toHaveBeenCalled();
  });
});
