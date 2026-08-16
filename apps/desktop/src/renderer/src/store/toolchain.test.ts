import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useToolchainStore } from './toolchain';
import { useWorkspaceStore } from './workspace';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useToolchainStore', () => {
  beforeEach(() => {
    useToolchainStore.setState(useToolchainStore.getInitialState());
    useWorkspaceStore.setState({ workspaceFolders: [{ path: '/repo', name: 'repo' }], activeFolderPath: '/repo' });
    installFakeDesktopApi();
  });

  describe('loadToolchain', () => {
    it('parses a valid .sde/toolchain.json from the active workspace folder', async () => {
      const readFile = vi.fn(async (path: string) => {
        expect(path).toBe('/repo/.sde/toolchain.json');
        return JSON.stringify({ pythonPath: '/usr/bin/python3' });
      });
      installFakeDesktopApi({ readFile: readFile as any });

      await useToolchainStore.getState().loadToolchain();

      expect(useToolchainStore.getState().config).toEqual({ pythonPath: '/usr/bin/python3' });
      expect(useToolchainStore.getState().loaded).toBe(true);
    });

    it('falls back to an empty config (not an error) when the file does not exist', async () => {
      installFakeDesktopApi({ readFile: vi.fn(async () => { throw new Error('ENOENT'); }) as any });

      await useToolchainStore.getState().loadToolchain();

      expect(useToolchainStore.getState().config).toEqual({});
      expect(useToolchainStore.getState().loaded).toBe(true);
    });

    it('falls back to an empty config on invalid JSON', async () => {
      installFakeDesktopApi({ readFile: vi.fn(async () => 'not json') as any });

      await useToolchainStore.getState().loadToolchain();

      expect(useToolchainStore.getState().config).toEqual({});
    });
  });

  describe('setToolchainPath', () => {
    it('creates .sde/ and writes the merged config to .sde/toolchain.json', async () => {
      const createDirectory = vi.fn(async () => true);
      const writeFile = vi.fn(async () => true);
      installFakeDesktopApi({ createDirectory: createDirectory as any, writeFile: writeFile as any });

      await useToolchainStore.getState().setToolchainPath('pythonPath', '/usr/bin/python3');

      expect(createDirectory).toHaveBeenCalledWith('/repo/.sde');
      expect(writeFile).toHaveBeenCalledWith('/repo/.sde/toolchain.json', JSON.stringify({ pythonPath: '/usr/bin/python3' }, null, 2));
      expect(useToolchainStore.getState().config).toEqual({ pythonPath: '/usr/bin/python3' });
    });

    it('setting an empty path removes that key rather than storing an empty string', async () => {
      useToolchainStore.setState({ config: { pythonPath: '/usr/bin/python3', nodePath: '/usr/bin/node' } });
      const writeFile = vi.fn(async () => true);
      installFakeDesktopApi({ createDirectory: vi.fn(async () => true) as any, writeFile: writeFile as any });

      await useToolchainStore.getState().setToolchainPath('pythonPath', '');

      expect(useToolchainStore.getState().config).toEqual({ nodePath: '/usr/bin/node' });
      expect(writeFile).toHaveBeenCalledWith('/repo/.sde/toolchain.json', JSON.stringify({ nodePath: '/usr/bin/node' }, null, 2));
    });
  });

  describe('getExtraPathEntries', () => {
    it('returns the directory (not the full binary path) for each configured interpreter', () => {
      useToolchainStore.setState({ config: { pythonPath: 'C:/Python312/python.exe', nodePath: 'C:/Program Files/nodejs/node.exe' } });

      expect(useToolchainStore.getState().getExtraPathEntries()).toEqual(['C:/Python312', 'C:/Program Files/nodejs']);
    });

    it('returns an empty array when nothing is configured', () => {
      expect(useToolchainStore.getState().getExtraPathEntries()).toEqual([]);
    });

    it('handles Windows backslash paths the same as forward-slash paths', () => {
      useToolchainStore.setState({ config: { pythonPath: 'C:\\Python312\\python.exe' } });

      expect(useToolchainStore.getState().getExtraPathEntries()).toEqual(['C:/Python312']);
    });
  });
});
