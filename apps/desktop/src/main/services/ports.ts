import { exec } from 'child_process';
import { BrowserWindow } from 'electron';
import localtunnel from 'localtunnel';
import type { PortEntry } from '@sde-code/protocol';

type Tunnel = Awaited<ReturnType<typeof localtunnel>>;

const POLL_INTERVAL_MS = 3500;
const NETSTAT_TIMEOUT_MS = 5000;
const SYSTEM_PROCESS_DENYLIST = new Set(['System', 'svchost.exe', 'wininit.exe', 'services.exe', 'lsass.exe']);

const registry = new Map<number, PortEntry>();
const tunnels = new Map<number, Tunnel>();
const terminalOutputBuffers = new Map<string, string>();
let broadcastWindow: BrowserWindow | null = null;
let pollHandle: ReturnType<typeof setInterval> | null = null;

/** Any window works — ports aren't scoped per-window like terminal sessions are. */
export function setPortsBroadcastWindow(window: BrowserWindow): void {
  broadcastWindow = window;
}

function broadcast(channel: 'ports:detected' | 'ports:closed', payload: PortEntry | number): void {
  if (broadcastWindow && !broadcastWindow.isDestroyed()) {
    broadcastWindow.webContents.send(channel, payload);
  }
}

function registerPort(entry: PortEntry): void {
  const existing = registry.get(entry.port);
  // Terminal-sourced entries are richer and arrive first — don't let a later netstat poll downgrade one to a plain 'system' entry.
  if (existing && existing.source === 'terminal' && entry.source === 'system') {
    return;
  }
  const merged: PortEntry = { ...existing, ...entry, label: existing?.label ?? entry.label, publicUrl: existing?.publicUrl ?? entry.publicUrl };
  registry.set(entry.port, merged);
  broadcast('ports:detected', merged);
}

async function unregisterPort(port: number): Promise<void> {
  if (!registry.has(port)) return;
  registry.delete(port);
  const tunnel = tunnels.get(port);
  if (tunnel) {
    tunnels.delete(port);
    try { tunnel.close(); } catch { /* best effort */ }
  }
  broadcast('ports:closed', port);
}

export function listPorts(): PortEntry[] {
  return Array.from(registry.values());
}

export function addManualPort(port: number): void {
  registerPort({ port, source: 'manual' });
}

export function removePort(port: number): Promise<void> {
  return unregisterPort(port);
}

export function setPortLabel(port: number, label: string): void {
  const existing = registry.get(port);
  if (!existing) return;
  const updated = { ...existing, label };
  registry.set(port, updated);
  broadcast('ports:detected', updated);
}

export async function startTunnel(port: number): Promise<{ url: string } | { error: string }> {
  try {
    const existing = tunnels.get(port);
    if (existing) {
      const entry = registry.get(port);
      return entry?.publicUrl ? { url: entry.publicUrl } : { error: 'Tunnel already starting.' };
    }
    const tunnel = await localtunnel({ port });
    tunnels.set(port, tunnel);
    tunnel.on('close', () => { tunnels.delete(port); });
    const entry = registry.get(port) ?? { port, source: 'manual' as const };
    registerPort({ ...entry, publicUrl: tunnel.url });
    return { url: tunnel.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to start tunnel.' };
  }
}

export async function stopTunnel(port: number): Promise<void> {
  const tunnel = tunnels.get(port);
  if (tunnel) {
    tunnels.delete(port);
    try { tunnel.close(); } catch { /* best effort */ }
  }
  const entry = registry.get(port);
  if (entry) {
    const { publicUrl, ...rest } = entry;
    void publicUrl;
    registry.set(port, rest);
    broadcast('ports:detected', rest);
  }
}

// ── Mechanism A: scan terminal output for URL/port patterns ──────────────

const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i;
const PORT_MENTION_PATTERN = /(?:listening|running|started)[^\n]{0,20}port\s+(\d{2,5})/i;
const MAX_BUFFER_CHARS = 500;

export function scanTerminalOutputForPorts(terminalId: string, chunk: string, cwd?: string): void {
  const prev = terminalOutputBuffers.get(terminalId) ?? '';
  const buffer = (prev + chunk).slice(-MAX_BUFFER_CHARS);
  terminalOutputBuffers.set(terminalId, buffer);

  const urlMatch = buffer.match(URL_PATTERN);
  const portMatch = buffer.match(PORT_MENTION_PATTERN);
  const match = urlMatch ?? portMatch;
  if (!match) return;

  const port = parseInt(match[1], 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return;

  registerPort({ port, source: 'terminal', label: cwd ? cwd.split(/[/\\]/).pop() : undefined });
}

export function clearTerminalOutputBuffer(terminalId: string): void {
  terminalOutputBuffers.delete(terminalId);
}

// ── Mechanism B: periodic OS-level netstat scan ───────────────────────────

interface ListeningSocket {
  port: number;
  pid: number;
}

export function parseNetstatOutput(output: string): ListeningSocket[] {
  const results: ListeningSocket[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TCP')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const [, localAddress, , state, pidStr] = parts;
    if (state !== 'LISTENING') continue;
    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(port) || !Number.isFinite(pid)) continue;
    results.push({ port, pid });
  }
  return results;
}

export function parseTasklistCsv(output: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // "name.exe","1234","Console","1","12,345 K"
    const fields = trimmed.match(/"([^"]*)"/g);
    if (!fields || fields.length < 2) continue;
    const name = fields[0].replace(/"/g, '');
    const pid = parseInt(fields[1].replace(/"/g, ''), 10);
    if (Number.isFinite(pid)) map.set(pid, name);
  }
  return map;
}

function execAsync(command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { timeout: NETSTAT_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
      // Fail quiet — a single failed poll cycle just skips this tick rather
      // than surfacing an error the user can't act on.
      resolve(error ? '' : stdout.toString());
    });
  });
}

let knownSystemPorts = new Set<number>();
const missedPollCounts = new Map<number, number>();

async function pollSystemPorts(): Promise<void> {
  const netstatOutput = await execAsync('netstat -ano -p TCP');
  if (!netstatOutput) return;
  const sockets = parseNetstatOutput(netstatOutput);

  const tasklistOutput = await execAsync('tasklist /FO CSV /NH');
  const pidToName = parseTasklistCsv(tasklistOutput);

  // allListeningPorts has no floor (used by the close-sweep below); the >= 1024 floor only gates which ports this mechanism registers as new entries — a noise filter, not a liveness signal.
  const allListeningPorts = new Set<number>();
  const currentPorts = new Set<number>();
  for (const { port, pid } of sockets) {
    allListeningPorts.add(port);
    if (port < 1024) continue;
    const processName = pidToName.get(pid);
    if (processName && SYSTEM_PROCESS_DENYLIST.has(processName)) continue;
    currentPorts.add(port);
    missedPollCounts.delete(port);
    if (!knownSystemPorts.has(port)) {
      registerPort({ port, pid, processName, source: 'system' });
    }
  }

  // netstat is ground truth for what's listening, closing both system- and terminal-sourced entries (manual entries are excluded); a port must miss two consecutive polls before closing, to tolerate netstat lag.
  for (const [port, entry] of registry) {
    if (entry.source === 'manual') continue;
    if (allListeningPorts.has(port)) {
      missedPollCounts.delete(port);
      continue;
    }
    const misses = (missedPollCounts.get(port) ?? 0) + 1;
    if (misses >= 2) {
      missedPollCounts.delete(port);
      void unregisterPort(port);
    } else {
      missedPollCounts.set(port, misses);
    }
  }

  knownSystemPorts = currentPorts;
}

export function startPortPolling(): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => { void pollSystemPorts(); }, POLL_INTERVAL_MS);
  void pollSystemPorts();
}

export function stopPortPolling(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}
