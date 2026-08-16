import { describe, expect, it, vi } from 'vitest';
import { createInProcessTransportPair } from './transport';

describe('createInProcessTransportPair', () => {
  it('delivers a message sent on one side to the other side\'s onMessage', () => {
    const [a, b] = createInProcessTransportPair();
    const listener = vi.fn();
    b.onMessage(listener);

    a.send({ type: 'register', kind: 'command', payload: { id: 'x' } });

    expect(listener).toHaveBeenCalledWith({ type: 'register', kind: 'command', payload: { id: 'x' } });
  });

  it('is two-way — b can send to a too', () => {
    const [a, b] = createInProcessTransportPair();
    const listener = vi.fn();
    a.onMessage(listener);

    b.send({ type: 'invokeResult', requestId: 'r1', result: 42 });

    expect(listener).toHaveBeenCalledWith({ type: 'invokeResult', requestId: 'r1', result: 42 });
  });

  it('a message sent on one side does not also fire that same side\'s own onMessage', () => {
    const [a] = createInProcessTransportPair();
    const listener = vi.fn();
    a.onMessage(listener);

    a.send({ type: 'register', kind: 'theme', payload: {} });

    expect(listener).not.toHaveBeenCalled();
  });

  it('disposing one side stops delivery without throwing on the other side\'s send', () => {
    const [a, b] = createInProcessTransportPair();
    const listener = vi.fn();
    b.onMessage(listener);

    b.dispose();
    expect(() => a.send({ type: 'register', kind: 'command', payload: {} })).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
