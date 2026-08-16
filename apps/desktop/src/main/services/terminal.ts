import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import path from 'path';
import { scanTerminalOutputForPorts, clearTerminalOutputBuffer } from './ports';

const terminalSessions = new Map<string, pty.IPty>();

export function createTerminalSession(window: BrowserWindow, terminalId: string, cwd: string, extraPathEntries: string[] = []): void {
  // Close any existing session for this ID if any
  closeTerminalSession(terminalId);

  // Windows uses PowerShell, not cmd.exe, since cmd's PROMPT env var can't shorten to just the leaf folder like the prompt override below does.
  const isWin = process.platform === 'win32';
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const system32 = path.join(systemRoot, 'System32');
  const powershellDir = path.join(system32, 'WindowsPowerShell', 'v1.0');
  const shell = isWin ? path.join(powershellDir, 'powershell.exe') : 'bash';

  // Session-local prompt override (via -Command, not $PROFILE) so it only affects this app's terminal, showing just the leaf folder name.
  const shortPromptFunction = 'function prompt { $__sdeLeaf = Split-Path -Leaf -Path (Get-Location); if ([string]::IsNullOrEmpty($__sdeLeaf)) { $__sdeLeaf = (Get-Location).Path }; "PS $__sdeLeaf> " }';
  const args = isWin ? ['-NoLogo', '-NoExit', '-Command', shortPromptFunction] : [];

  // Construct env, ensuring critical Windows system paths exist and any Toolchain-selected interpreter directories (store/toolchain.ts) come first so `python`/`node` resolve to them.
  const env: Record<string, string> = { ...process.env, FORCE_COLOR: '1' } as any;
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
  const existingPath = env[pathKey] || '';
  const paths = existingPath.split(path.delimiter).map(p => p.trim()).filter(Boolean);

  if (isWin) {
    const wbem = path.join(system32, 'Wbem');
    const requiredPaths = [system32, systemRoot, wbem, powershellDir];
    for (const req of requiredPaths) {
      if (!paths.some(p => p.toLowerCase() === req.toLowerCase())) {
        paths.unshift(req);
      }
    }
  }

  for (const entry of extraPathEntries) {
    if (entry && !paths.some(p => p.toLowerCase() === entry.toLowerCase())) {
      paths.unshift(entry);
    }
  }
  env[pathKey] = paths.join(path.delimiter);

  // Spawn native pseudo-terminal (PTY)
  try {
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd,
      env
    });

    terminalSessions.set(terminalId, ptyProcess);

    // Stream pty output to the React frontend
    ptyProcess.onData((data) => {
      window.webContents.send('terminal:output', { terminalId, data });
      scanTerminalOutputForPorts(terminalId, data, cwd);
    });

    // Handle shell exit
    ptyProcess.onExit(({ exitCode }) => {
      window.webContents.send('terminal:output', {
        terminalId,
        data: `\r\n[SDE Code Terminal Process Exited with Code: ${exitCode}]\r\n`
      });
      terminalSessions.delete(terminalId);
      clearTerminalOutputBuffer(terminalId);
    });
  } catch (err) {
    console.error('Failed to spawn PTY:', err);
    window.webContents.send('terminal:output', { 
      terminalId, 
      data: `\r\n[Failed to spawn native terminal process: ${err}]\r\n` 
    });
  }
}

export function writeTerminalInput(terminalId: string, data: string): void {
  const session = terminalSessions.get(terminalId);
  if (session) {
    session.write(data);
  }
}

export function resizeTerminalSession(terminalId: string, cols: number, rows: number): void {
  const session = terminalSessions.get(terminalId);
  if (session) {
    try {
      session.resize(cols, rows);
    } catch (err) {
      console.error(`Failed to resize terminal session ${terminalId}:`, err);
    }
  }
}

export function closeTerminalSession(terminalId: string): void {
  const session = terminalSessions.get(terminalId);
  if (session) {
    try {
      session.kill();
    } catch (err) {
      console.error(`Error terminating shell session ${terminalId}:`, err);
    }
    terminalSessions.delete(terminalId);
  }
  clearTerminalOutputBuffer(terminalId);
}

/** Kills every live terminal session — call this on app quit, since a live child process holds the OS process tree open and can keep Electron from fully exiting. */
export function closeAllTerminalSessions(): void {
  for (const terminalId of [...terminalSessions.keys()]) {
    closeTerminalSession(terminalId);
  }
}
