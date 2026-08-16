import { describe, expect, it, vi } from 'vitest';
import { CancellationToken, CancellationTokenSource } from './cancellation';

describe('CancellationTokenSource', () => {
  it('token starts un-cancelled', () => {
    const source = new CancellationTokenSource();
    expect(source.token.isCancellationRequested).toBe(false);
  });

  it('cancel() flips the token and notifies subscribers', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);

    source.cancel();

    expect(source.token.isCancellationRequested).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cancel() is idempotent — subscribers are not notified twice', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);

    source.cancel();
    source.cancel();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribing after cancellation fires immediately with the already-cancelled state', () => {
    const source = new CancellationTokenSource();
    source.cancel();

    const lateListener = vi.fn();
    source.token.onCancellationRequested(lateListener);

    expect(lateListener).toHaveBeenCalledTimes(1);
  });

  it('dispose() releases listeners without marking the token cancelled', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);

    source.dispose();

    expect(source.token.isCancellationRequested).toBe(false);
    expect(() => source.cancel()).not.toThrow();
  });
});

describe('CancellationToken.None / Cancelled', () => {
  it('None reports not cancelled and never invokes subscribers', () => {
    const listener = vi.fn();
    CancellationToken.None.onCancellationRequested(listener);
    expect(CancellationToken.None.isCancellationRequested).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('Cancelled reports cancelled and invokes subscribers immediately', () => {
    const listener = vi.fn();
    CancellationToken.Cancelled.onCancellationRequested(listener);
    expect(CancellationToken.Cancelled.isCancellationRequested).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
