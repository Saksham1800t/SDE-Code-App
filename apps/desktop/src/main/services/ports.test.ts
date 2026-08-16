import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));
vi.mock('localtunnel', () => ({ default: vi.fn() }));

import { parseNetstatOutput, parseTasklistCsv, scanTerminalOutputForPorts, listPorts, clearTerminalOutputBuffer } from './ports';

describe('parseNetstatOutput', () => {
  it('parses LISTENING TCP lines into {port, pid} pairs', () => {
    const output = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       5678
`;
    expect(parseNetstatOutput(output)).toEqual([
      { port: 3000, pid: 1234 },
      { port: 5173, pid: 5678 },
    ]);
  });

  it('ignores non-LISTENING and non-TCP lines', () => {
    const output = `
  TCP    192.168.1.5:54321      93.184.216.34:443      ESTABLISHED     999
  UDP    0.0.0.0:5353           *:*                                    111
`;
    expect(parseNetstatOutput(output)).toEqual([]);
  });

  it('returns an empty array for empty or malformed input', () => {
    expect(parseNetstatOutput('')).toEqual([]);
    expect(parseNetstatOutput('garbage\nmore garbage')).toEqual([]);
  });
});

describe('parseTasklistCsv', () => {
  it('builds a pid -> process name map from CSV rows', () => {
    const output = [
      '"node.exe","1234","Console","1","54,321 K"',
      '"System","4","Services","0","8 K"',
    ].join('\n');
    const map = parseTasklistCsv(output);
    expect(map.get(1234)).toBe('node.exe');
    expect(map.get(4)).toBe('System');
  });

  it('ignores malformed rows without throwing', () => {
    const map = parseTasklistCsv('not a csv row\n\n"onlyonefield"');
    expect(map.size).toBe(0);
  });
});

describe('scanTerminalOutputForPorts', () => {
  it('registers a port from a "Local: http://localhost:PORT" style banner', () => {
    scanTerminalOutputForPorts('term-1', '  Local:   http://localhost:5188/\n', '/repo');
    const entry = listPorts().find((p) => p.port === 5188);
    expect(entry?.source).toBe('terminal');
  });

  it('registers a port from a plain "listening on port N" message', () => {
    scanTerminalOutputForPorts('term-2', 'Server listening on port 4321\n');
    expect(listPorts().find((p) => p.port === 4321)?.source).toBe('terminal');
  });

  it('detects a URL split across two chunks via the rolling buffer', () => {
    scanTerminalOutputForPorts('term-3', 'Local: http://localhost:61');
    scanTerminalOutputForPorts('term-3', '23/\n');
    expect(listPorts().find((p) => p.port === 6123)?.source).toBe('terminal');
  });

  it('does not register anything for ordinary output with no port mention', () => {
    const before = listPorts().length;
    scanTerminalOutputForPorts('term-4', 'Compiling...\nDone in 1.2s\n');
    expect(listPorts().length).toBe(before);
  });

  it('clearTerminalOutputBuffer stops a subsequent split match from completing', () => {
    scanTerminalOutputForPorts('term-5', 'Local: http://localhost:71');
    clearTerminalOutputBuffer('term-5');
    scanTerminalOutputForPorts('term-5', '23/\n');
    expect(listPorts().find((p) => p.port === 7123)).toBeUndefined();
  });
});
