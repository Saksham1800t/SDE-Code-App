import { create } from 'zustand';
import type { UpdaterStatus } from '../../../shared/updaterTypes';
import { notify } from './notifications';

interface UpdaterState extends UpdaterStatus {
  /** Subscribes to main-process updater:status pushes — call once on app startup, like the other stores' initialize() methods. */
  initialize: () => void;
  /** Command Palette "Check for Updates" — unlike the silent startup check, every outcome
   * (checking/available/not-available/error) gets a toast, not just a downloaded-update banner. */
  checkForUpdates: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  state: 'idle',

  initialize: () => {
    window.api?.onUpdaterStatus?.((status) => {
      set(status);
      // Errors always surface — this was the actual bug: previously the only UI wired to
      // updater state was the "downloaded" banner, so a failed silent startup check (the
      // common case for an unsigned Windows build) produced no visible feedback at all.
      if (status.state === 'error') {
        notify.error(status.message || 'Update check failed.', 'Update');
      } else if (status.manual) {
        if (status.state === 'available') {
          notify.info(`Update available: v${status.version} — downloading in the background.`, 'Update');
        } else if (status.state === 'not-available') {
          notify.success("You're on the latest version.", 'Update');
        }
      }
    });
  },

  checkForUpdates: () => {
    window.api?.checkForUpdates?.(true);
  },
}));
