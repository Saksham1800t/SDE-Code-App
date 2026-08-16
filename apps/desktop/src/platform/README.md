# platform

## Responsibility
Injectable *services*: the things a feature needs but shouldn't construct
itself — configuration, logging, storage/persistence, git, the AI provider
registry, the extension registry. Each service is declared as an interface +
a `createServiceIdentifier` token, with one or more concrete implementations.

## What's here

- **`instantiation/`** — the DI container itself:
  - `createServiceIdentifier<T>('id')` — a branded token standing in for an
    interface at runtime. No parameter decorators, no `reflect-metadata`
    (see the doc comment in `serviceIdentifier.ts` for why): a service
    declares its own dependencies as a plain `static readonly inject = [...]`
    array instead.
  - `ServiceCollection` — the registry mapping identifiers to either a
    resolved instance or a `SyncDescriptor` (a lazy-construction recipe).
    Built explicitly at the composition root (in `host/`, once that exists)
    rather than assembled implicitly via decorator side effects scattered
    across the codebase.
  - `InstantiationService` — resolves a `ServiceCollection`, constructing
    descriptor-backed services on first use and memoizing them as
    singletons. Supports `createChild(...)` for later per-window or
    per-extension-host scopes. Takes ownership of disposing any singleton
    *it* constructed (see the doc comments on `getService`/`createInstance`
    for the ownership boundary — it matters).
- **`log/`** — `ILogService` + `ConsoleLogService`, the first (deliberately
  boring) service registered through the container above, chosen to prove
  the wiring works before trusting it with anything with real business logic.
- **`git/`** — `IGitService` + `GitService`, migrated from the original
  static-methods class in `main/services/git.ts` (now deleted). The first
  real, already-working feature moved onto the DI pattern — same behavior,
  now an injectable instance that takes `ILogService` instead of calling
  `console.error` directly. Covered by integration tests that run real git
  commands against a temp directory, not mocks.
- **`fs/`** — `IFileSystemService` + `FileSystemService`, migrated from
  inline closures in the old `main/ipc.ts` fs:* handlers. Covers the pure
  filesystem operations (readDir/readFile/writeFile/createFile/
  createDirectory); `fs:openFolder` stays inline in `host/ipc.ts` since it
  orchestrates Electron's native dialog plus registering a project via
  `DatabaseService` — not a pure filesystem operation. Also tested against
  a real temp directory, not mocks.
- **`db/`** — `IDatabaseService` + `DatabaseService`, migrated from the
  module-level `DatabaseAPI` object + free-standing `db`/`dbPath` globals
  in the old `main/db/index.ts` (now deleted). `initialize(dbFilePath)`
  takes the actual file path as a parameter instead of reaching for
  Electron's `app.getPath('userData')` itself, keeping this service plain
  Node/sql.js underneath — `host/index.ts` computes that path and awaits
  `initialize()` before anything else touches the database. Exactly one
  instance exists for the whole process (exported from `host/services.ts`);
  `main/services/indexer.ts` (not yet on DI itself) imports that same
  instance directly rather than getting its own — two independent sql.js
  databases writing to the same file would silently diverge. A real bug was
  caught writing this service's tests: sql.js doesn't validate a buffer in
  `new SQL.Database(buffer)` — a corrupt file only throws once queried,
  which the original code's try/catch didn't cover, so a corrupt DB file
  would have crashed `initialize()` instead of falling back to a fresh
  database. Fixed.
- **`ai/`** — `IAiService` + `AiService`, migrated from the free-standing
  `queryAIService()`/`abortAIRequest()` in the old `main/services/ai.ts`
  (now deleted). Same provider logic (Gemini/OpenAI-compatible/Anthropic
  streaming) and parsers, but takes `ILogService`+`IDatabaseService` as
  real dependencies instead of a module-level import, and a caller-supplied
  `AiQuerySink` (`onChunk`/`onError` callbacks) replaces the raw
  `BrowserWindow` parameter — keeps this service Electron-agnostic like
  everything else in `platform` except `ipc/`; `host/ipc.ts` is the one
  that knows which window a query came from and bridges the sink to
  `win.webContents.send(...)`. A real bug was caught writing this service's
  tests, too: the Gemini stream parser treated the *first* `}` character in
  the buffer as an object's end, which breaks on any realistically-nested
  response (every real Gemini candidate is 4 levels deep) — replaced with a
  brace-depth-tracking scanner. Provider streaming isn't tested against the
  real APIs (that would mean live third-party network calls in CI); the
  provider-selection/missing-API-key logic and each parser are tested
  against a mocked `fetch` returning canned response bytes instead.
- **`ipc/`** — `createIpcHandlerRegistrar`/`createIpcInvokerFactory`, a small
  typed-IPC mechanism: given a per-domain contract type (e.g. `GitIpcContract`
  in `@sde-code/protocol`), both the main-process handler registration
  (`host/ipc.ts`) and the preload invoker (`preload/index.ts`) are checked
  against the exact same function signatures. The one place in `platform`
  that reaches for Electron's `ipcMain`/`ipcRenderer` directly — everything
  else here is Electron-agnostic.

## Allowed imports
`kernel` only (intra-repo layer imports — `ipc/` also uses Electron's
`ipcMain`/`ipcRenderer` directly, which isn't a cross-layer import our
lint rule tracks, just a real runtime dependency worth knowing about).

## Why it exists
Two reasons to isolate this from the workbench UI:
1. **Testability.** A service with a defined interface can be swapped for a
   fake in unit tests without booting Electron or React.
2. **Reuse.** `editor`, `extension-host`, and `workbench` all need git status,
   logging, and config — they should all consume the *same* service instance
   through DI, not each reach into `main/services/*.ts` directly the way the
   current `ipc.ts` does.
