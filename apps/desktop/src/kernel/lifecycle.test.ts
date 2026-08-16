import { describe, expect, it, vi } from 'vitest';
import { Disposable, DisposableStore, toDisposable } from './lifecycle';

describe('DisposableStore', () => {
  it('disposes every registered entry on dispose()', () => {
    const store = new DisposableStore();
    const a = vi.fn();
    const b = vi.fn();
    store.add(toDisposable(a));
    store.add(toDisposable(b));

    store.dispose();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('disposes new registrations immediately once already disposed', () => {
    const store = new DisposableStore();
    store.dispose();

    const lateFn = vi.fn();
    store.add(toDisposable(lateFn));

    expect(lateFn).toHaveBeenCalledTimes(1);
  });

  it('dispose() is idempotent', () => {
    const store = new DisposableStore();
    const fn = vi.fn();
    store.add(toDisposable(fn));

    store.dispose();
    store.dispose();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clear() disposes entries but keeps the store usable', () => {
    const store = new DisposableStore();
    const first = vi.fn();
    store.add(toDisposable(first));
    store.clear();
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    store.add(toDisposable(second));
    store.dispose();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('delete() disposes and forgets a single entry without affecting the rest', () => {
    const store = new DisposableStore();
    const kept = vi.fn();
    const removed = vi.fn();
    const removedDisposable = toDisposable(removed);
    store.add(toDisposable(kept));
    store.add(removedDisposable);

    store.delete(removedDisposable);
    expect(removed).toHaveBeenCalledTimes(1);

    store.dispose();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1); // not double-disposed
  });
});

describe('Disposable', () => {
  it('disposes everything registered via _register when the subclass is disposed', () => {
    const cleanup = vi.fn();
    class Widget extends Disposable {
      constructor() {
        super();
        this._register(toDisposable(cleanup));
      }
    }

    const widget = new Widget();
    widget.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('Disposable.None is a safe no-op', () => {
    expect(() => Disposable.None.dispose()).not.toThrow();
  });
});
