/** Something that holds a resource (event listener, timer, child process, file watcher) that must be explicitly released. */
export interface IDisposable {
  dispose(): void;
}

/** Wraps a plain cleanup function as an {@link IDisposable}. */
export function toDisposable(fn: () => void): IDisposable {
  return { dispose: fn };
}

/** A collection of disposables that are disposed together; add each as it's created, call `dispose()` once at the end of the owner's lifetime. */
export class DisposableStore implements IDisposable {
  private readonly disposables = new Set<IDisposable>();
  private isDisposed = false;

  /** Registers `disposable` for later cleanup and returns it unchanged; if the store is already disposed, disposes it immediately instead, so call sites never need to check lifecycle state. */
  add<T extends IDisposable>(disposable: T): T {
    if (this.isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this.disposables.add(disposable);
    return disposable;
  }

  /** Disposes and forgets a single entry, without affecting the rest of the store. */
  delete(disposable: IDisposable): void {
    if (this.disposables.delete(disposable)) {
      disposable.dispose();
    }
  }

  /** Disposes every registered entry but leaves the store usable for new registrations. */
  clear(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.clear();
  }

  /** Disposes every registered entry and marks the store itself as permanently disposed. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.clear();
  }
}

/** Base class for anything that owns disposable resources; subclasses call `this._register(...)` for each resource instead of managing a store field by hand. */
export abstract class Disposable implements IDisposable {
  /** A no-op disposable, for APIs that require one but have nothing to release. */
  static readonly None: IDisposable = Object.freeze({ dispose(): void {} });

  private readonly store = new DisposableStore();

  protected _register<T extends IDisposable>(disposable: T): T {
    return this.store.add(disposable);
  }

  dispose(): void {
    this.store.dispose();
  }
}
