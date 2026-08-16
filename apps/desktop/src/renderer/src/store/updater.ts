import { create } from 'zustand';
import type { UpdaterStatus } from '../../../shared/updaterTypes';

interface UpdaterState extends UpdaterStatus {
  /** Subscribes to main-process updater:status pushes — call once on app startup, like the other stores' initialize() methods. */
  initialize: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  state: 'idle',

  initialize: () => {
    window.api?.onUpdaterStatus?.((status) => set(status));
  },
}));
