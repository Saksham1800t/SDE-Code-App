# extension-host

## Responsibility
The runtime that loads, activates, and mediates calls for third-party
extensions: reading manifests, deciding when to activate an extension
(lazily, on an activation event — not eagerly, unlike the current
`extensions store`), and exposing the contract defined in `@sde-code/sdk` to
extension code. This is *not* the public API extensions code against
(that's `@sde-code/sdk`, a separate versioned package) — this is the private
machinery that enforces it.

## Allowed imports
`kernel`, `platform`, `editor` (extensions may need to contribute editor
commands/languages), `@sde-code/protocol`, `@sde-code/sdk` (types only).
**Not** `workbench` — extension-host must not know about specific panels or
UI components; it only knows about contribution *points* (command, status-bar
item, theme) that `workbench` later renders.

## Why it exists
Splitting this from `workbench` is the single most consequential boundary in
the whole app: it's what will eventually let an extension run out-of-process
(a real "host" in the VS Code sense) without a rewrite, and it's what keeps
"is this extension well-behaved" a separate question from "how does the
sidebar render."

Worth knowing before touching this layer: **as of today, nothing in this app
actually loads or executes an installed extension's code.** Extension
manifests are downloaded and stored as JSON; theme colors are read straight
out of that JSON; commands/status-bar items/AI providers are hardcoded in
the renderer. `@sde-code/sdk`'s `registerCommand`/etc. write to a
`globalThis.sde` object that nothing reads. This layer is the first real
extension runtime, not a refinement of an existing one.

## What's here so far

- **`protocol/`** — the message-passing layer between an extension and the
  host, built *as if* it already had to cross a real process boundary, even
  though v1's transport (`createInProcessTransportPair`) is same-process:
  - `messages.ts` — `RegisterMessage`/`InvokeMessage`/`InvokeChunkMessage`/
    `InvokeResultMessage`. Deliberately generic across every contribution
    kind (commands, status bar, themes, and the future AI provider/tool/
    context-provider surface) — nothing here is kind-specific. A
    registration's `payload` is opaque data; if it needs to reference a
    callback, that's just a `callbackId` field inside the payload, which
    the RPC layer never inspects.
  - `transport.ts` — `IExtensionTransport`, the seam a future separate-
    process host swaps (one new implementation, nothing above it changes).
  - `rpcHost.ts` / `rpcExtensionSide.ts` — the two-sided RPC built on top of
    a transport. Neither side ever holds a live reference to the other's
    functions: the extension side keeps real callbacks in a local map keyed
    by a generated ID and only ever sends that ID; the host asks to
    `invoke(callbackId, args)` and gets a `Promise` back, or
    `invokeStreaming(callbackId, args, onChunk)` for callbacks that report
    progress before resolving (built now so a future `AIProvider.
    streamCompletion` doesn't need a protocol redesign, even though nothing
    registers a streaming callback yet).

Not yet built: the vm-based sandbox that actually loads an extension's
`dist/index.js` and gives it one end of a transport pair; the per-kind
registries (command/status-bar/theme) that interpret `register` messages;
the rewritten `@sde-code/sdk` that calls through to `RpcExtensionSide`
instead of writing to `globalThis.sde`; activation-event matching.
