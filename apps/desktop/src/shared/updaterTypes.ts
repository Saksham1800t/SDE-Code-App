/** Shared across main (electron-updater's own events) and renderer (store/updater.ts) — same reason serverConfig.ts lives here, see its own doc comment. */
export interface UpdaterStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  /** True when this status came from a user-triggered "Check for Updates", not the silent
   * startup check — the renderer uses this to decide whether 'checking'/'not-available' are
   * worth a toast (annoying on every launch) or only worth surfacing when the user asked. */
  manual?: boolean;
}
