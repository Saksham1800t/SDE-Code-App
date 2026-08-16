import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'path';
import fs from 'fs';
import { ConsoleLogService } from '../platform';
import { databaseService, extensionHostService, logService, snippetsService, mcpService, lspService, dapService, externalAgentService, notebookKernelService } from './services';
import { registerIPCHandlers } from './ipc';
import { setPortsBroadcastWindow, startPortPolling } from '../main/services/ports';
import { closeAllTerminalSessions } from '../main/services/terminal';
import { setUpdaterBroadcastWindow, checkForUpdates } from '../main/services/updater';

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  await databaseService.initialize(join(userDataPath, 'sde-code.db'));

  const snippetsDirPath = join(userDataPath, 'snippets');
  if (!fs.existsSync(snippetsDirPath)) {
    fs.mkdirSync(snippetsDirPath, { recursive: true });
  }
  await snippetsService.initialize(snippetsDirPath);

  mcpService.initialize().catch((err) => logService.error('Failed to initialize MCP servers:', err));

  const extensionsDir = join(__dirname, '../../extensions');
  const extensionCount = await extensionHostService.discoverExtensions(extensionsDir);
  logService.info(`Discovered ${extensionCount} extension(s) in ${extensionsDir}.`);
  await extensionHostService.fireActivationEvent('onStartupFinished');

  registerIPCHandlers();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: join(__dirname, '../../dist/sde-taskbar-icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#07080b',
      symbolColor: '#f1f5f9',
      height: 37
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    backgroundColor: '#0B0C10',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Delayed so the update check doesn't compete with startup indexing/LSP work for I/O and CPU.
    setTimeout(() => checkForUpdates(), 3000);
  });

  setPortsBroadcastWindow(mainWindow);
  setUpdaterBroadcastWindow(mainWindow);
  startPortPolling();
  lspService.setBroadcastWindow(mainWindow);
  dapService.setBroadcastWindow(mainWindow);
  const win = mainWindow;
  win.webContents.once('did-finish-load', () => {
    (logService as ConsoleLogService).setBroadcastSink((line) => win.webContents.send('log:entry', line));
  });

  mainWindow.removeMenu();
  Menu.setApplicationMenu(null);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeAllTerminalSessions();
  mcpService.disposeAll();
  lspService.disposeAll();
  dapService.disposeAll();
  externalAgentService.disposeAll();
  notebookKernelService.disposeAll();
});
