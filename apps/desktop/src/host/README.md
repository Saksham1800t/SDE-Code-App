# host

## Responsibility
The Electron entry points: main-process bootstrap (`app.whenReady`, window
creation), the preload bridge, and process wiring — creating the DI
container, registering platform services into it, starting the extension
host, then handing off to the workbench. This is the "outermost" layer: it
knows about everything below it so it can wire the app together, but nothing
below it should know `host` exists.

## Allowed imports
Everything: `kernel`, `platform`, `editor`, `extension-host`, `workbench`,
`@sde-code/protocol`.

## Why it exists
Kept separate from `platform` so that "how the app boots on Electron
specifically" is distinguishable from "what a service does," which matters
if this app ever needs a non-Electron host (a CLI mode, a future web target)
reusing the same platform/editor/workbench layers.

## What's here so far

- **`index.ts`** — the Electron entry point (`app.whenReady`, window
  creation). Moved here from the old `main/index.ts`, keeping the filename
  `index.ts` (not `main.ts`, despite this not being a re-export barrel like
  other layers' `index.ts` files) — `vite-plugin-electron` names its build
  output after the entry file's basename, and `package.json`'s `"main"`
  field expects `dist-electron/main/index.js`.
- **`ipc.ts`** — IPC channel registration. Moved here from the old
  `main/ipc.ts`. The `git:*`, `fs:*`, and `db:*` channels are registered
  through `createIpcHandlerRegistrar<Contract>()` (see `platform/ipc/`) —
  typed against `@sde-code/protocol`'s `GitIpcContract`/`FsIpcContract`/
  `DbIpcContract`, the same contracts `preload/index.ts`'s invokers are
  checked against. `ai:query` is typed against `AiIpcContract` too, but
  registered by hand (`ipcMain.handle` directly, not the registrar) since
  it needs `event` to resolve the originating `BrowserWindow` — the
  registrar deliberately doesn't expose that (git/fs/db never needed it).
  `ai:abort`/`ai:chunk`/`ai:err` aren't request/response shaped
  (fire-and-forget / push events) so they're not part of any typed contract
  yet. Every other channel group (`terminal:*`, `search:*`, `extension:*`)
  is still the original flat `ipcMain.handle('channel', ...)` pattern — not
  yet migrated, one group at a time, the same way git, fs, db, and ai were.
- **`services.ts`** — the composition root: builds the `ServiceCollection`,
  registers `ILogService`/`IGitService`/`IFileSystemService`/
  `IDatabaseService`/`IAiService`, resolves an `InstantiationService`, and
  exports the resolved instances. `index.ts` awaits
  `databaseService.initialize(...)` explicitly at startup (construction is
  sync; initialization is async and needs Electron's `app.getPath`, so it
  can't happen at module-eval time the way the other services' resolution
  does). `main/services/indexer.ts` (not on DI itself yet) imports this
  same `databaseService` instance directly — never construct a second one,
  or you'll end up with two sql.js databases silently diverging. Still
  growing: `main/services/{indexer,extensionInstaller,terminal}` haven't
  been migrated onto the DI pattern yet — `ipc.ts` still imports and calls
  them directly. Each deserves the same one-at-a-time treatment GitService,
  FileSystemService, DatabaseService, and AiService got.
