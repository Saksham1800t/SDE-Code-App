import { describe, expect, it, vi } from 'vitest';
import { createInProcessTransportPair } from '../protocol/transport';
import { RpcHost } from '../protocol/rpcHost';
import { RpcExtensionSide } from '../protocol/rpcExtensionSide';
import { createSandboxRequire } from './sdkBridge';
import { loadExtensionInSandbox } from './vmSandbox';

function setup(onRegister: (kind: string, payload: unknown) => void = () => {}) {
  const [hostTransport, extensionTransport] = createInProcessTransportPair();
  const host = new RpcHost(hostTransport, onRegister);
  const extensionSide = new RpcExtensionSide(extensionTransport);
  const requireFn = createSandboxRequire(extensionSide);
  return { host, requireFn };
}

describe('createSandboxRequire / createSdkBridge', () => {
  it('denies any module other than @sde-code/sdk', () => {
    const { requireFn } = setup();
    expect(() => requireFn('fs')).toThrow(/not available/);
  });

  it("real extension source calling registerCommand results in a 'command' registration on the host", () => {
    const onRegister = vi.fn();
    const { requireFn } = setup(onRegister);

    const source = `
      const { registerCommand } = require('@sde-code/sdk');
      registerCommand('foo.bar', () => 'handled');
    `;
    loadExtensionInSandbox(source, '/fake/index.js', requireFn);

    expect(onRegister).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({ id: 'foo.bar', callbackId: expect.any(String) }),
    );
  });

  it('a registered command can actually be invoked end-to-end and returns its real result', async () => {
    let capturedPayload: { id: string; callbackId: string } | undefined;
    const { host, requireFn } = setup((kind, payload) => {
      if (kind === 'command') capturedPayload = payload as { id: string; callbackId: string };
    });

    const source = `
      const { registerCommand } = require('@sde-code/sdk');
      registerCommand('foo.bar', (x) => x * 2);
    `;
    loadExtensionInSandbox(source, '/fake/index.js', requireFn);

    expect(capturedPayload).toBeDefined();
    await expect(host.invoke(capturedPayload!.callbackId, [21])).resolves.toBe(42);
  });

  it("registerStatusBarItem results in a 'statusBarItem' registration with the plain options payload", () => {
    const onRegister = vi.fn();
    const { requireFn } = setup(onRegister);

    const source = `
      const { registerStatusBarItem } = require('@sde-code/sdk');
      registerStatusBarItem('foo.status', { text: 'Active', alignment: 'right' });
    `;
    loadExtensionInSandbox(source, '/fake/index.js', requireFn);

    expect(onRegister).toHaveBeenCalledWith('statusBarItem', {
      id: 'foo.status',
      options: { text: 'Active', alignment: 'right' },
    });
  });

  it("registerTheme results in a 'theme' registration with the plain variables payload", () => {
    const onRegister = vi.fn();
    const { requireFn } = setup(onRegister);

    const source = `
      const { registerTheme } = require('@sde-code/sdk');
      registerTheme('foo.dark', { bgPrimary: '#000', bgSecondary: '#111', textPrimary: '#fff', accentCyan: '#0ff' });
    `;
    loadExtensionInSandbox(source, '/fake/index.js', requireFn);

    expect(onRegister).toHaveBeenCalledWith('theme', {
      id: 'foo.dark',
      variables: { bgPrimary: '#000', bgSecondary: '#111', textPrimary: '#fff', accentCyan: '#0ff' },
    });
  });

  it("registerAITool results in an 'aiTool' registration whose callback executes the real tool", async () => {
    let capturedPayload: { name: string; callbackId: string } | undefined;
    const { host, requireFn } = setup((kind, payload) => {
      if (kind === 'aiTool') capturedPayload = payload as { name: string; callbackId: string };
    });

    const source = `
      const { registerAITool } = require('@sde-code/sdk');
      registerAITool({
        name: 'echo',
        description: 'Echoes the input back',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
        execute: async (args) => 'echo: ' + args.text,
      });
    `;
    loadExtensionInSandbox(source, '/fake/index.js', requireFn);

    expect(capturedPayload?.name).toBe('echo');
    await expect(host.invoke(capturedPayload!.callbackId, [{ text: 'hi' }])).resolves.toBe('echo: hi');
  });
});
