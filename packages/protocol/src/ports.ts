/** Push events (ports:detected/closed) aren't part of this typed contract — registered directly via ipcMain/webContents.send instead. */
export interface PortEntry {
  port: number;
  pid?: number;
  processName?: string;
  label?: string;
  source: 'terminal' | 'system' | 'manual';
  publicUrl?: string;
}

export type PortsIpcContract = {
  'ports:list': () => Promise<PortEntry[]>;
  'ports:addManual': (port: number) => Promise<void>;
  'ports:remove': (port: number) => Promise<void>;
  'ports:setLabel': (port: number, label: string) => Promise<void>;
  'ports:startTunnel': (port: number) => Promise<{ url: string } | { error: string }>;
  'ports:stopTunnel': (port: number) => Promise<void>;
  'ports:openExternal': (url: string) => Promise<void>;
};
