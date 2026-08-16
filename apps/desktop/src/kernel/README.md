# kernel

The lowest layer. Zero dependency on Node.js, the DOM, Electron, or any other
layer in this app.

## Responsibility
Generic primitives every other layer needs and none of them should reimplement:
- **`lifecycle.ts`** — `IDisposable`, `toDisposable`, `DisposableStore`, and the
  `Disposable` base class. The pattern every stateful thing in this app follows:
  own your resources, register them via `this._register(...)`, release them
  all via one `dispose()` call instead of hand-tracking cleanup.
- **`event.ts`** — `Emitter<T>` / `Event<T>`, a typed pub/sub primitive (not
  Node's `EventEmitter`). Consumers only ever see the `Event<T>` function type,
  never the `Emitter` itself, so they can subscribe but never fire someone
  else's event. Subscribing returns an `IDisposable`.
- **`cancellation.ts`** — `CancellationToken` / `CancellationTokenSource`, for
  telling a long-running operation to stop early without an exception. Pass
  the read-only `CancellationToken` down; keep the `CancellationTokenSource`
  (the thing that can actually cancel) to yourself.

Not yet added (future, as something actually needs them): Result/either-style
error types, small collection/async helpers (debounce, throttle, retry).

## Allowed imports
Nothing from this repo. Only pure npm utility libraries with no I/O.

## Why it exists
Every other layer — platform services, the editor, the workbench, the
extension host — needs the same handful of primitives (how do you unsubscribe
from something, how do you cancel an in-flight operation, how do you represent
"this failed" without throwing). If each layer invents its own, cross-layer
code becomes inconsistent and untestable in isolation. `kernel` is the one
place these are defined, and its zero-dependency rule is what makes it safe
for literally everything else to depend on.
