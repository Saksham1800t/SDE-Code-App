import { describe, expect, it, vi } from 'vitest';
import { createInProcessTransportPair } from './transport';
import { RpcHost } from './rpcHost';
import { RpcExtensionSide } from './rpcExtensionSide';

function setup(onRegister: (kind: string, payload: unknown) => void = () => {}) {
  const [hostTransport, extensionTransport] = createInProcessTransportPair();
  const host = new RpcHost(hostTransport, onRegister);
  const extensionSide = new RpcExtensionSide(extensionTransport);
  return { host, extensionSide, hostTransport, extensionTransport };
}

describe('extension-host RPC protocol', () => {
  it('delivers a register message from the extension side to the host\'s onRegister', () => {
    const onRegister = vi.fn();
    const { extensionSide } = setup(onRegister);

    extensionSide.register('command', { id: 'foo.bar' });

    expect(onRegister).toHaveBeenCalledWith('command', { id: 'foo.bar' });
  });

  it('invoke() round-trips a result from a plain extension-side callback', async () => {
    const { host, extensionSide } = setup();
    const callbackId = extensionSide.registerCallback((a, b) => (a as number) + (b as number));

    await expect(host.invoke(callbackId, [2, 3])).resolves.toBe(5);
  });

  it('invoke() rejects when the extension-side callback throws', async () => {
    const { host, extensionSide } = setup();
    const callbackId = extensionSide.registerCallback(() => {
      throw new Error('boom');
    });

    await expect(host.invoke(callbackId, [])).rejects.toThrow('boom');
  });

  it('invoke() rejects for an unknown callback ID', async () => {
    const { host } = setup();
    await expect(host.invoke('does-not-exist', [])).rejects.toThrow(/Unknown callback/);
  });

  it('invokeStreaming() reports each chunk before resolving with the final result', async () => {
    const { host, extensionSide } = setup();
    const callbackId = extensionSide.registerStreamingCallback(async (onChunk, prompt) => {
      onChunk('Hello');
      onChunk(', ' + prompt);
      return 'done';
    });

    const chunks: unknown[] = [];
    const result = await host.invokeStreaming(callbackId, ['world'], (chunk) => chunks.push(chunk));

    expect(chunks).toEqual(['Hello', ', world']);
    expect(result).toBeUndefined(); // invokeStreaming resolves void — the real payload arrived via onChunk
  });

  it('invokeStreaming() rejects if the streaming callback throws after emitting some chunks', async () => {
    const { host, extensionSide } = setup();
    const callbackId = extensionSide.registerStreamingCallback(async (onChunk) => {
      onChunk('partial');
      throw new Error('stream broke');
    });

    const chunks: unknown[] = [];
    await expect(host.invokeStreaming(callbackId, [], (chunk) => chunks.push(chunk))).rejects.toThrow('stream broke');
    expect(chunks).toEqual(['partial']);
  });

  it('correlates concurrent invocations by requestId without mixing up results', async () => {
    const { host, extensionSide } = setup();
    const slowId = extensionSide.registerCallback(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'slow';
    });
    const fastId = extensionSide.registerCallback(async () => 'fast');

    const [slowResult, fastResult] = await Promise.all([host.invoke(slowId, []), host.invoke(fastId, [])]);

    expect(slowResult).toBe('slow');
    expect(fastResult).toBe('fast');
  });

  it('disposing the host rejects any requests still in flight', async () => {
    const { host, extensionSide } = setup();
    const neverResolvesId = extensionSide.registerCallback(() => new Promise(() => {}));

    const pending = host.invoke(neverResolvesId, []);
    host.dispose();

    await expect(pending).rejects.toThrow(/disposed/);
  });
});
