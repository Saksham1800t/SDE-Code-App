import { create } from 'zustand';
import { NotificationEntry, NotificationLevel } from '../types/notifications';

const AUTO_DISMISS_MS: Record<NotificationLevel, number | null> = {
  info: 5000,
  success: 5000,
  warning: 8000,
  // Longer than warning, not indefinite — error text tends to be denser/more technical
  // (stack traces, API error bodies), so it gets more time to be read before it clears itself.
  error: 12000,
};
const MAX_HISTORY = 100;

interface NotificationsState {
  entries: NotificationEntry[];
  notify: (level: NotificationLevel, message: string, title?: string) => string;
  dismiss: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  entries: [],

  notify: (level, message, title) => {
    const id = Math.random().toString(36).slice(2);
    const entry: NotificationEntry = { id, level, message, title, timestamp: Date.now(), dismissed: false, read: false };
    set({ entries: [entry, ...get().entries].slice(0, MAX_HISTORY) });

    const delay = AUTO_DISMISS_MS[level];
    if (delay !== null) {
      setTimeout(() => get().dismiss(id), delay);
    }
    return id;
  },

  dismiss: (id) => {
    set({ entries: get().entries.map((e) => (e.id === id ? { ...e, dismissed: true } : e)) });
  },

  markAllRead: () => {
    set({ entries: get().entries.map((e) => ({ ...e, read: true })) });
  },

  clearAll: () => set({ entries: [] }),
}));

// Themed replacement for scattering raw error strings inline — call
// notify.error(...) from anywhere (no hook needed) the same way
// customAlert()/customPrompt() are called outside components.
export const notify = {
  info: (message: string, title?: string) => useNotificationsStore.getState().notify('info', message, title),
  success: (message: string, title?: string) => useNotificationsStore.getState().notify('success', message, title),
  warning: (message: string, title?: string) => useNotificationsStore.getState().notify('warning', message, title),
  error: (message: string, title?: string) => useNotificationsStore.getState().notify('error', message, title),
};
