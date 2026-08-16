import { create } from 'zustand';

export interface OutputChannel {
  id: string;
  label: string;
  lines: string[];
}

interface OutputState {
  channels: Record<string, OutputChannel>;
  activeChannelId: string;
  registerChannel: (id: string, label: string) => void;
  appendLine: (channelId: string, line: string) => void;
  clearChannel: (channelId: string) => void;
  setActiveChannel: (id: string) => void;
}

const MAX_LINES_PER_CHANNEL = 2000;

export const useOutputStore = create<OutputState>((set, get) => ({
  channels: {},
  activeChannelId: '',

  registerChannel: (id, label) => {
    if (get().channels[id]) return;
    const channels = { ...get().channels, [id]: { id, label, lines: [] } };
    set({ channels, activeChannelId: get().activeChannelId || id });
  },

  appendLine: (channelId, line) => {
    const channel = get().channels[channelId];
    if (!channel) return;
    const lines = [...channel.lines, line].slice(-MAX_LINES_PER_CHANNEL);
    set({ channels: { ...get().channels, [channelId]: { ...channel, lines } } });
  },

  clearChannel: (channelId) => {
    const channel = get().channels[channelId];
    if (!channel) return;
    set({ channels: { ...get().channels, [channelId]: { ...channel, lines: [] } } });
  },

  setActiveChannel: (id) => set({ activeChannelId: id }),
}));

let consoleCaptureInstalled = false;

/** Mirrors console.error/warn into a "Console" Output channel. Idempotent — safe to call more than once (e.g. React StrictMode double-invoke). */
export function initializeOutputCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  useOutputStore.getState().registerChannel('console', 'Console');

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  const format = (args: unknown[]) =>
    args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');

  console.error = (...args: unknown[]) => {
    useOutputStore.getState().appendLine('console', `[error] ${format(args)}`);
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    useOutputStore.getState().appendLine('console', `[warn] ${format(args)}`);
    originalWarn(...args);
  };

  // "Main Process" channel: every backend service logs through one ConsoleLogService instance, forwarded here via a single log:entry push event.
  useOutputStore.getState().registerChannel('main-process', 'Main Process');
  window.api?.onLogEntry?.((line) => {
    useOutputStore.getState().appendLine('main-process', line);
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
