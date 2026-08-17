import { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdaterStatus } from '../../shared/updaterTypes';

let broadcastWindow: BrowserWindow | null = null;
let wired = false;
// Read by each autoUpdater event handler at broadcast time, since the events themselves
// (checking-for-update, update-available, ...) don't carry any indication of what triggered
// the check that's currently in flight.
let currentCheckIsManual = false;

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

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking', manual: currentCheckIsManual }));
  autoUpdater.on('update-available', (info) => broadcast({ state: 'available', version: info.version, manual: currentCheckIsManual }));
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available', manual: currentCheckIsManual }));
  autoUpdater.on('download-progress', (progress) => broadcast({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version: info.version }));
  // Unlike the states above, errors matter regardless of who triggered the check — a silent
  // startup check that fails should still be visible, not swallowed (this was the actual bug:
  // the only UI ever wired to updater state was the "downloaded" banner, so every other
  // outcome, including real failures, was invisible).
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: err.message, manual: currentCheckIsManual }));
}

/**
 * Windows-only for now — macOS auto-update needs a code-signing certificate to satisfy
 * Gatekeeper, which isn't set up yet (see apps/desktop's release notes). Also a no-op in a
 * dev run (VITE_DEV_SERVER_URL set): there's no packaged app-update.yml for electron-updater
 * to read outside a real installed build.
 *
 * `manual` distinguishes a user-triggered "Check for Updates" (Command Palette) from the
 * silent 3-second-after-startup check — see UpdaterStatus.manual's doc comment.
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (process.platform !== 'win32' || process.env.VITE_DEV_SERVER_URL) {
    if (manual) broadcast({ state: 'error', message: 'Auto-update is only available on Windows right now.', manual: true });
    return;
  }
  ensureWired();
  currentCheckIsManual = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err), manual });
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
