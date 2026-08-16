import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpService } from './mcpService';
import { DatabaseService } from '../db';
import { FakeLogService } from '../log';

// A real fake MCP server — a tiny Node script speaking newline-delimited
// JSON-RPC 2.0 over stdio, per MCP's stdio transport spec. Matches this
// codebase's established "spawn a real subprocess, no mocking" testing
// convention (gitService.test.ts spawns real git the same way).
const FAKE_SERVER_SCRIPT = `
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1.0.0' } } });
    } else if (msg.method === 'notifications/initialized') {
      // no response expected
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echoes the input back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } });
    } else if (msg.method === 'tools/call') {
      const text = (msg.params && msg.params.arguments && msg.params.arguments.text) || '';
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo: ' + text }] } });
    }
  }
});
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}
// Also emit an occasional plain-text log line to stdout, to confirm the client skips non-JSON lines rather than crashing.
console.log('fake mcp server started');
`;

const FAILING_SERVER_SCRIPT = `process.exit(1);`;

describe('McpService (real subprocess MCP server, no mocking)', () => {
  let tmpDir: string;
  let databaseService: DatabaseService;
  let log: FakeLogService;
  let service: McpService;
  let fakeServerPath: string;
  let failingServerPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-mcp-test-'));
    log = new FakeLogService();
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    service = new McpService(log, databaseService);

    fakeServerPath = path.join(tmpDir, 'fake-mcp-server.js');
    fs.writeFileSync(fakeServerPath, FAKE_SERVER_SCRIPT);
    failingServerPath = path.join(tmpDir, 'failing-server.js');
    fs.writeFileSync(failingServerPath, FAILING_SERVER_SCRIPT);
  });

  afterEach(() => {
    service.disposeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('connects to a real server, lists its tools, and reports connected status', async () => {
    await service.saveServer({ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: true });

    const states = service.getServerStates();
    expect(states).toEqual([{ id: 'fake1', status: 'connected', error: undefined, toolCount: 1 }]);

    const tools = service.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_fake_echo');
    expect(tools[0].description).toBe('Echoes the input back.');
  }, 10000);

  it('an MCP tool\'s execute() round-trips a real tools/call request to the server', async () => {
    await service.saveServer({ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: true });

    const tool = service.listTools()[0];
    const result = await tool.execute({ text: 'hello' });

    expect(result).toBe('echo: hello');
  }, 10000);

  it('a disabled server does not connect and contributes no tools', async () => {
    await service.saveServer({ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: false });

    expect(service.getServerStates()).toEqual([{ id: 'fake1', status: 'disconnected', error: undefined, toolCount: 0 }]);
    expect(service.listTools()).toEqual([]);
  });

  it('a server whose process exits immediately reports an error status, not a hang or throw', async () => {
    await service.saveServer({ id: 'bad1', name: 'bad', command: process.execPath, args: [failingServerPath], enabled: true });

    const states = service.getServerStates();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe('error');
    expect(states[0].toolCount).toBe(0);
  }, 10000);

  it('deleteServer removes the server and its tools stop being listed', async () => {
    await service.saveServer({ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: true });
    expect(service.listTools()).toHaveLength(1);

    await service.deleteServer('fake1');

    expect(service.getServers()).toEqual([]);
    expect(service.listTools()).toEqual([]);
  }, 10000);

  it('persists server configs across instances via the database (getSettings/setSetting round-trip)', async () => {
    await service.saveServer({ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: false });

    const second = new McpService(new FakeLogService(), databaseService);
    await second.initialize();

    expect(second.getServers()).toEqual([{ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: false }]);
    second.disposeAll();
  });

  it('reconnectServer retries a server and can recover its connection', async () => {
    await service.saveServer({ id: 'fake1', name: 'fake', command: process.execPath, args: [fakeServerPath], enabled: true });
    expect(service.getServerStates()[0].status).toBe('connected');

    const reconnected = await service.reconnectServer('fake1');

    expect(reconnected).toBe(true);
    expect(service.getServerStates()[0].status).toBe('connected');
  }, 15000);
});
