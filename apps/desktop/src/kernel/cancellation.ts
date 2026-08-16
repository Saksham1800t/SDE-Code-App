import { Disposable, IDisposable } from './lifecycle';
import { Emitter, Event } from './event';

/** A read-only handle to poll or subscribe to for early-stop; pass it down into whatever you're cancelling, keep the {@link CancellationTokenSource} to yourself. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}

class MutableToken extends Disposable implements CancellationToken {
  private cancelled = false;
  private readonly emitter = this._register(new Emitter<void>());

  get isCancellationRequested(): boolean {
    return this.cancelled;
  }

  readonly onCancellationRequested: Event<void> = (listener) => {
    if (this.cancelled) {
      listener(undefined);
      return Disposable.None;
    }
    return this.emitter.event(listener);
  };

  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.emitter.fire();
  }
}

/** The producer side: create one, hand out `.token`, call `.cancel()` to signal it. */
export class CancellationTokenSource implements IDisposable {
  private readonly _token = new MutableToken();

  get token(): CancellationToken {
    return this._token;
  }

  cancel(): void {
    this._token.cancel();
  }

  /** Disposing without cancelling leaves the token permanently un-cancelled but releases its listeners. */
  dispose(): void {
    this._token.dispose();
  }
}

export namespace CancellationToken {
  export const None: CancellationToken = Object.freeze({
    isCancellationRequested: false,
    onCancellationRequested: () => Disposable.None,
  });

  export const Cancelled: CancellationToken = Object.freeze({
    isCancellationRequested: true,
    onCancellationRequested: (listener: (value: void) => void) => {
      listener();
      return Disposable.None;
    },
  });
}
