/** MCP client for stdio-launched local servers only; their tools merge into the same flow as extension-contributed AI tools. */
export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerState {
  id: string;
  status: McpServerStatus;
  error?: string;
  /** Tool count once connected — 0 while disconnected/connecting. */
  toolCount: number;
}

export type McpIpcContract = {
  'mcp:getServers': () => Promise<McpServerConfig[]>;
  /** Upserts by id (a new random id if creating) — saving an enabled server (re)connects it, saving a disabled one disconnects it. */
  'mcp:saveServer': (config: McpServerConfig) => Promise<boolean>;
  'mcp:deleteServer': (id: string) => Promise<boolean>;
  'mcp:getServerStates': () => Promise<McpServerState[]>;
  /** Manually retries a disconnected/errored server — servers otherwise only (re)connect on save. */
  'mcp:reconnectServer': (id: string) => Promise<boolean>;
};
