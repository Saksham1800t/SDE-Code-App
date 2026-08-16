import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';

export interface ToolchainConfig {
  pythonPath?: string;
  nodePath?: string;
}

const TOOLCHAIN_FILE_RELATIVE = '.sde/toolchain.json';

interface ToolchainState {
  config: ToolchainConfig;
  loading: boolean;
  /** True once loadToolchain has resolved at least once (success, empty, or missing file) — lets createNewTerminal (store/terminal.ts) know whether it can trust getExtraPathEntries() yet or must load first. */
  loaded: boolean;
  loadToolchain: () => Promise<void>;
  setToolchainPath: (key: keyof ToolchainConfig, filePath: string) => Promise<void>;
  /** Directories to prepend to a new terminal's PATH so `python`/`node` resolve to the interpreters selected here — see store/terminal.ts's createNewTerminal. */
  getExtraPathEntries: () => string[];
}

function activeFolder(): string | null {
  return useWorkspaceStore.getState().activeFolderPath ?? useWorkspaceStore.getState().workspaceFolders[0]?.path ?? null;
}

function dirnameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(0, idx);
}

/** Per-project toolchain interpreter paths, stored in `.sde/toolchain.json` — same file-in-the-workspace convention as `.sde/tasks.json` (store/tasks.ts), not the app's global settings DB, since this genuinely travels with the project rather than the user. */
export const useToolchainStore = create<ToolchainState>((set, get) => ({
  config: {},
  loading: false,
  loaded: false,

  loadToolchain: async () => {
    const api = window.api;
    const folder = activeFolder();
    if (!api || !folder) {
      set({ config: {}, loaded: true });
      return;
    }
    set({ loading: true });
    try {
      const raw = await api.readFile(`${folder.replace(/\\/g, '/')}/${TOOLCHAIN_FILE_RELATIVE}`);
      const parsed = JSON.parse(raw);
      set({ config: typeof parsed === 'object' && parsed !== null ? parsed : {} });
    } catch {
      // No .sde/toolchain.json yet (or invalid JSON) — same as "nothing configured", not an error the user needs to see.
      set({ config: {} });
    } finally {
      set({ loading: false, loaded: true });
    }
  },

  setToolchainPath: async (key, filePath) => {
    const api = window.api;
    const folder = activeFolder();
    if (!api || !folder) return;
    const nextConfig: ToolchainConfig = { ...get().config, [key]: filePath || undefined };
    if (!filePath) delete nextConfig[key];
    set({ config: nextConfig });

    const normalizedFolder = folder.replace(/\\/g, '/');
    try {
      await api.createDirectory(`${normalizedFolder}/.sde`);
      await api.writeFile(`${normalizedFolder}/${TOOLCHAIN_FILE_RELATIVE}`, JSON.stringify(nextConfig, null, 2));
    } catch (err) {
      console.error('Failed to save .sde/toolchain.json:', err);
    }
  },

  getExtraPathEntries: () => {
    const { pythonPath, nodePath } = get().config;
    return [pythonPath, nodePath].filter((p): p is string => Boolean(p)).map(dirnameOf);
  },
}));

