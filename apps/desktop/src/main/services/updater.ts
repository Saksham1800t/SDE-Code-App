import { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdaterStatus } from '../../shared/updaterTypes';

let broadcastWindow: BrowserWindow | null = null;
let wired = false;

/** Any window works — updates aren't scoped per-window. */
export function setUpdaterBroadcastWindow(window: BrowserWindow): void {
  broadcastWindow = window;
}

function broadcast(status: UpdaterStatus): void {
  if (broadcastWindow && !broadcastWindow.isDestroyed()) {
    broadcastWindow.webContents.send('updater:status', status);
  }
}

/** Registers autoUpdater's event listeners exactly once; checkForUpdates() below can be called repeatedly afterward. */
function ensureWired(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => broadcast({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available' }));
  autoUpdater.on('download-progress', (progress) => broadcast({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: err.message }));
}

/**
 * Windows-only for now — macOS auto-update needs a code-signing certificate to satisfy
 * Gatekeeper, which isn't set up yet (see apps/desktop's release notes). Also a no-op in a
 * dev run (VITE_DEV_SERVER_URL set): there's no packaged app-update.yml for electron-updater
 * to read outside a real installed build.
 */
export async function checkForUpdates(): Promise<void> {
  if (process.platform !== 'win32' || process.env.VITE_DEV_SERVER_URL) return;
  ensureWired();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
