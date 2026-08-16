/** Shared across main (electron-updater's own events) and renderer (store/updater.ts) — same reason serverConfig.ts lives here, see its own doc comment. */
export interface UpdaterStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}
