import { Disposable, IDisposable, toDisposable } from './lifecycle';

/** A typed subscription function returning an {@link IDisposable} that stops listening; consumers never see the {@link Emitter}, so they can't call `.fire()`. */
export type Event<T> = (listener: (value: T) => void) => IDisposable;

/** The producer side of an {@link Event}; firing while a listener disposes itself (or another) is safe since iteration runs over a fire-time snapshot. */
export class Emitter<T> implements IDisposable {
  private listeners: Set<(value: T) => void> | null = new Set();

  readonly event: Event<T> = (listener) => {
    if (!this.listeners) {
      return Disposable.None; // emitter already disposed; subscribing is a no-op
    }
    this.listeners.add(listener);
    return toDisposable(() => this.listeners?.delete(listener));
  };

  fire(value: T): void {
    if (!this.listeners || this.listeners.size === 0) {
      return;
    }
    for (const listener of Array.from(this.listeners)) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners = null;
  }
}
