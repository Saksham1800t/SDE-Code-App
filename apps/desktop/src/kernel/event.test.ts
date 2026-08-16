import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './event';

describe('Emitter', () => {
  it('delivers fired values to all subscribed listeners', () => {
    const emitter = new Emitter<number>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.event(a);
    emitter.event(b);

    emitter.fire(42);

    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it('stops delivering to a listener after its subscription is disposed', () => {
    const emitter = new Emitter<number>();
    const listener = vi.fn();
    const subscription = emitter.event(listener);

    subscription.dispose();
    emitter.fire(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that unsubscribes another listener mid-fire does not crash, and the snapshot already taken still runs', () => {
    // Iteration runs over a snapshot taken at fire() time, so a listener
    // disposed by an earlier listener in the same fire() still receives
    // *this* event (it was already in the snapshot) but never another.
    const emitter = new Emitter<number>();
    const b = vi.fn();
    let subB: { dispose(): void };

    const a = vi.fn(() => subB.dispose());
    emitter.event(a);
    subB = emitter.event(b);

    emitter.fire(1);
    expect(b).toHaveBeenCalledTimes(1);

    emitter.fire(2);
    expect(b).toHaveBeenCalledTimes(1); // no further calls after being disposed
  });

  it('subscribing after dispose() is a safe no-op', () => {
    const emitter = new Emitter<number>();
    emitter.dispose();

    const listener = vi.fn();
    const subscription = emitter.event(listener);
    expect(() => subscription.dispose()).not.toThrow();

    emitter.fire(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('firing with no listeners does not throw', () => {
    const emitter = new Emitter<void>();
    expect(() => emitter.fire()).not.toThrow();
  });
});
