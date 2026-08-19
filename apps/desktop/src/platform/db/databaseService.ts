import fs from 'fs';
import initSqlJs from 'sql.js';
import type {
  FeatureFlagRow,
  EffectiveFeatureFlagRow,
  SettingsMap,
  ConversationRow,
  CommandRow,
  KeybindingRow,
  ProfileRow,
  ExtensionRow,
  SaveExtensionInput,
  ThemeRow,
  SaveThemeInput,
  ProjectRuleRow,
  ProjectMemoryRow,
  FileHistoryEntry,
  SymbolRow,
  ImportRow,
  RouteRow,
  FrontendCallSiteRow,
} from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  last_opened: number;
  trust_state: string | null;
}

export interface IDatabaseService {
  /** Loads (or creates) the sql.js database at `dbFilePath` and runs migrations; must be awaited once before anything else is called. Keeps this class plain Node/sql.js, no Electron dependency, so it's testable like GitService/FileSystemService. */
  initialize(dbFilePath: string): Promise<void>;

  // Low-level query helpers, for callers that aren't fully on the
  // high-level methods below yet (main/services/indexer.ts).
  queryAll<T>(sql: string, params?: unknown[]): T[];
  queryOne<T>(sql: string, params?: unknown[]): T | null;
  run(sql: string, params?: unknown[]): void;
  /** Runs `fn` as one SQL transaction with exactly one disk flush at the end, instead of `run()`'s normal one-flush-per-call (O(n²) in a tight loop); rolls back and rethrows on error without flushing. `fn` must be synchronous. */
  transaction<T>(fn: () => T): T;

  getFeatureFlags(): FeatureFlagRow[];
  /** Merges the global (project_id='') row with a workspace override row when one exists — the override wins; `workspace_enabled` is null when it inherits the global value. */
  getEffectiveFeatureFlags(projectId: string): EffectiveFeatureFlagRow[];
  /** Omit projectId (or pass '') to write the global/User-scope row. */
  setFeatureFlag(name: string, isEnabled: boolean, projectId?: string): boolean;
  /** Deletes just the workspace override row, reverting to the User value. */
  clearWorkspaceFlagOverride(name: string, projectId: string): boolean;
  /** Omit profileId (or pass 'default') for the global settings only. A non-default profileId merges the profile's overrides on top — same "override layer on a global baseline" shape extension_workspace_state already uses. */
  getSettings(profileId?: string): SettingsMap;
  /** Omit profileId (or pass 'default') to write the global row directly. A non-default profileId writes to that profile's override instead, leaving the global value untouched. */
  setSetting(key: string, value: string, profileId?: string): boolean;
  getConversations(projectId: string): ConversationRow[];
  saveConversation(id: string, projectId: string, title: string, messages: string): boolean;
  deleteConversation(id: string): boolean;
  /** Rows written by indexer.ts, read by the Code Map's ImpactAnalysisService — see packages/protocol/src/db.ts. */
  getSymbols(projectId: string): SymbolRow[];
  getImports(projectId: string): ImportRow[];
  getRoutes(projectId: string): RouteRow[];
  getFrontendCallSites(projectId: string): FrontendCallSiteRow[];
  getProjectRules(projectId: string): ProjectRuleRow[];
  saveProjectRule(id: string, projectId: string, ruleText: string): boolean;
  setProjectRuleActive(id: string, isActive: boolean): boolean;
  deleteProjectRule(id: string): boolean;
  getProjectMemories(projectId: string): ProjectMemoryRow[];
  saveProjectMemory(id: string, projectId: string, memoryKey: string, memoryVal: string): boolean;
  deleteProjectMemory(id: string): boolean;
  getProjects(): ProjectRow[];
  addProject(id: string, name: string, pathStr: string): boolean;
  /** null = never asked (renderer should prompt); persisted per-folder so re-opening doesn't re-ask. */
  getProjectTrustState(pathStr: string): 'trusted' | 'restricted' | null;
  setProjectTrustState(pathStr: string, state: 'trusted' | 'restricted'): boolean;
  getCommands(): CommandRow[];
  getKeybindings(platform: string, profileId?: string): KeybindingRow[];
  setKeybinding(commandId: string, keyCombination: string, platform: string, profileId?: string): boolean;
  resetKeybindings(platform: string, profileId?: string): boolean;
  /** Every keybinding profile that exists, oldest first. Always includes at least 'default'. */
  getProfiles(): ProfileRow[];
  /** Creates a profile and seeds it with DEFAULT_KEYBINDINGS for every platform (not just the caller's current one) — a brand-new profile with zero keybindings would silently break basics like Ctrl+S/Ctrl+C the moment it's switched to. */
  createProfile(id: string, name: string): boolean;
  renameProfile(id: string, name: string): boolean;
  /** No-ops (returns false) for the 'default' profile — it's the fallback every getKeybindings()/setKeybinding() call defaults to, so it can never be deleted. Also deletes the profile's keybindings across every platform. */
  deleteProfile(id: string): boolean;
  /** A non-default profileId overlays that profile's enabled/disabled overrides onto each row's global is_enabled — same shape as getSettings' profile merge. */
  getExtensions(profileId?: string): ExtensionRow[];
  setExtensionEnabled(id: string, isEnabled: boolean, profileId?: string): boolean;
  saveExtension(ext: SaveExtensionInput): boolean;
  deleteExtension(id: string): boolean;
  /** Per-workspace enable/disable overlay — separate from the extension's own global `is_enabled`. */
  getWorkspaceExtensionOverrides(projectId: string): Record<string, boolean>;
  setWorkspaceExtensionEnabled(extensionId: string, projectId: string, isEnabled: boolean): boolean;
  clearWorkspaceExtensionOverride(extensionId: string, projectId: string): boolean;
  getThemes(): ThemeRow[];
  saveTheme(theme: SaveThemeInput): boolean;
  /** No-ops (returns true, no insert) if content matches the most recent snapshot for this file — repeated saves with no real change shouldn't bloat history. Prunes to the most recent 50 snapshots per (workspacePath, filePath). */
  saveFileSnapshot(workspacePath: string, filePath: string, content: string): boolean;
  /** Most recent first; excludes `content` to keep the list cheap — fetch it separately via getFileSnapshotContent. */
  getFileHistory(workspacePath: string, filePath: string): FileHistoryEntry[];
  getFileSnapshotContent(id: string): string | null;
}

export const IDatabaseService = createServiceIdentifier<IDatabaseService>('databaseService');

const DEFAULT_FEATURE_FLAGS = [
  { name: 'auto-save', is_enabled: 1, description: 'Automatically saves edited code files after a delay.' },
  { name: 'command-safety-gate', is_enabled: 1, description: 'Intercepts potentially harmful terminal commands for developer approval.' },
  { name: 'project-indexing', is_enabled: 1, description: 'Scans and indexes workspace codebases for deep AI understanding.' },
  { name: 'ai-autocomplete', is_enabled: 0, description: 'Enables real-time inline ghost text autocomplete suggestions (Experimental).' },
  { name: 'git-heatmap', is_enabled: 0, description: 'Shows a GitHub-style commit activity heatmap in the Source Control panel.' },
  { name: 'code-map', is_enabled: 0, description: 'Shows a spatial Code Map with AI-powered impact analysis of your codebase (Experimental).' },
];

const DEFAULT_COMMANDS = [
  { id: 'file.newFile', name: 'New File', category: 'File', description: 'Create a new file in workspace', source: 'core' },
  { id: 'file.newFolder', name: 'New Folder', category: 'File', description: 'Create a new folder in workspace', source: 'core' },
  { id: 'file.openFolder', name: 'Open Folder...', category: 'File', description: 'Open a project folder', source: 'core' },
  { id: 'workspace.trustFolder', name: 'Workspace: Trust This Folder', category: 'Workspace', description: 'Exit Restricted Mode and enable Agent Mode file edits/terminal commands for this folder', source: 'core' },
  { id: 'workspace.saveAs', name: 'Save Workspace As...', category: 'Workspace', description: 'Save every open folder as a .sde-workspace file', source: 'core' },
  { id: 'workspace.open', name: 'Open Workspace...', category: 'Workspace', description: 'Restore every folder listed in a .sde-workspace file', source: 'core' },
  { id: 'file.saveFile', name: 'Save File', category: 'File', description: 'Save the active code file', source: 'core' },
  { id: 'file.closeFile', name: 'Close Active Tab', category: 'File', description: 'Close the current editor tab', source: 'core' },
  { id: 'file.closeFolder', name: 'Close Folder', category: 'File', description: 'Close the active workspace', source: 'core' },
  { id: 'file.exit', name: 'Exit', category: 'File', description: 'Exit SDE Code', source: 'core' },
  { id: 'edit.undo', name: 'Undo', category: 'Edit', description: 'Undo last text edit', source: 'core' },
  { id: 'edit.redo', name: 'Redo', category: 'Edit', description: 'Redo last undone text edit', source: 'core' },
  { id: 'edit.cut', name: 'Cut', category: 'Edit', description: 'Cut selection to clipboard', source: 'core' },
  { id: 'edit.copy', name: 'Copy', category: 'Edit', description: 'Copy selection to clipboard', source: 'core' },
  { id: 'edit.paste', name: 'Paste', category: 'Edit', description: 'Paste clipboard content', source: 'core' },
  { id: 'edit.configureUserSnippets', name: 'Configure User Snippets', category: 'Edit', description: "Open (or create) the snippets file for the active editor's language", source: 'core' },
  { id: 'edit.goToDefinition', name: 'Go to Definition', category: 'Edit', description: "Jump to the symbol's definition (requires a language service, e.g. TypeScript/JavaScript)", source: 'core' },
  { id: 'edit.peekDefinition', name: 'Peek Definition', category: 'Edit', description: "Show the symbol's definition inline without leaving the current file", source: 'core' },
  { id: 'edit.findAllReferences', name: 'Find All References', category: 'Edit', description: 'List every usage of the symbol under the cursor', source: 'core' },
  { id: 'edit.renameSymbol', name: 'Rename Symbol', category: 'Edit', description: 'Rename the symbol under the cursor everywhere it is used', source: 'core' },
  { id: 'edit.renameSymbolPreview', name: 'Rename Symbol (Preview)', category: 'Edit', description: 'Preview a cross-file rename in an editable diff before applying it', source: 'core' },
  { id: 'edit.formatDocument', name: 'Format Document', category: 'Edit', description: 'Reformat the active file using its language service', source: 'core' },
  { id: 'view.toggleZenMode', name: 'Toggle Zen Mode', category: 'View', description: 'Hide the sidebar, activity bar, status bar, and panel, leaving just the editor', source: 'core' },
  { id: 'app.checkForUpdates', name: 'Check for Updates', category: 'Help', description: 'Manually check for a new version (Windows only) and show the result as a notification', source: 'core' },
  { id: 'view.splitEditorRight', name: 'Split Editor Right', category: 'View', description: 'Open a second editor pane to the right, showing the active file', source: 'core' },
  { id: 'view.closeEditorGroup', name: 'Close Editor Group', category: 'View', description: 'Close every tab in the focused editor pane', source: 'core' },
  { id: 'view.explorer', name: 'Toggle Explorer', category: 'View', description: 'Open the sidebar file tree', source: 'core' },
  { id: 'view.git', name: 'Toggle Source Control', category: 'View', description: 'Open the git control panel', source: 'core' },
  { id: 'view.settings', name: 'Toggle Settings', category: 'View', description: 'Open the settings dashboard', source: 'core' },
  { id: 'view.keyboardShortcuts', name: 'Open Keyboard Shortcuts', category: 'View', description: 'Search and rebind command shortcuts', source: 'core' },
  { id: 'tasks.runTask', name: 'Run Task...', category: 'Tasks', description: 'Run a command defined in .sde/tasks.json', source: 'core' },
  { id: 'view.repoOverview', name: 'Repository Overview', category: 'View', description: 'Open the repository overview dashboard', source: 'core' },
  { id: 'view.codeHotspots', name: 'Code Hotspots', category: 'View', description: 'Open the file change-frequency hotspots view', source: 'core' },
  { id: 'view.branchComparison', name: 'Compare Branches', category: 'View', description: 'Open the branch comparison view', source: 'core' },
  { id: 'view.gitGraph', name: 'Git Graph', category: 'View', description: 'Open the interactive commit graph', source: 'core' },
  { id: 'markdown.openPreview', name: 'Open Preview', category: 'Markdown', description: 'Open a rendered preview of the active Markdown file to the side', source: 'core' },
  { id: 'terminal.new', name: 'New Terminal', category: 'Terminal', description: 'Launch a new terminal session', source: 'core' },
  { id: 'terminal.toggle', name: 'Toggle Terminal', category: 'Terminal', description: 'Show or hide the terminal panel', source: 'core' },
  { id: 'window.minimize', name: 'Minimize', category: 'Window', description: 'Minimize application window', source: 'core' },
  { id: 'window.maximize', name: 'Maximize', category: 'Window', description: 'Maximize or restore application window', source: 'core' },
  { id: 'window.reload', name: 'Reload Window', category: 'Window', description: 'Reload the active window', source: 'core' },
  { id: 'help.about', name: 'About SDE Code', category: 'Help', description: 'View version and authors', source: 'core' },
  { id: 'help.devtools', name: 'Toggle Developer Tools', category: 'Help', description: 'Toggle Electron DevTools console', source: 'core' },
];

const DEFAULT_KEYBINDINGS = [
  { command_id: 'file.newFile', key_combination: 'Ctrl+N', platform: 'win32' },
  { command_id: 'file.newFolder', key_combination: 'Ctrl+Shift+N', platform: 'win32' },
  { command_id: 'file.openFolder', key_combination: 'Ctrl+O', platform: 'win32' },
  { command_id: 'file.saveFile', key_combination: 'Ctrl+S', platform: 'win32' },
  { command_id: 'file.closeFile', key_combination: 'Ctrl+W', platform: 'win32' },
  { command_id: 'file.exit', key_combination: 'Alt+F4', platform: 'win32' },
  { command_id: 'edit.undo', key_combination: 'Ctrl+Z', platform: 'win32' },
  { command_id: 'edit.redo', key_combination: 'Ctrl+Y', platform: 'win32' },
  { command_id: 'edit.cut', key_combination: 'Ctrl+X', platform: 'win32' },
  { command_id: 'edit.copy', key_combination: 'Ctrl+C', platform: 'win32' },
  { command_id: 'edit.paste', key_combination: 'Ctrl+V', platform: 'win32' },
  { command_id: 'view.explorer', key_combination: 'Ctrl+Shift+E', platform: 'win32' },
  { command_id: 'view.git', key_combination: 'Ctrl+Shift+G', platform: 'win32' },
  { command_id: 'view.settings', key_combination: 'Ctrl+Shift+I', platform: 'win32' },
  { command_id: 'terminal.new', key_combination: 'Ctrl+Shift+`', platform: 'win32' },
  { command_id: 'terminal.toggle', key_combination: 'Ctrl+`', platform: 'win32' },
  { command_id: 'window.reload', key_combination: 'Ctrl+R', platform: 'win32' },
  { command_id: 'help.devtools', key_combination: 'F12', platform: 'win32' },
  // F12 is already Developer Tools above, so Go to Definition uses Ctrl+F12 instead (Ctrl+Click also always works, via Monaco's built-in gesture).
  { command_id: 'edit.goToDefinition', key_combination: 'Ctrl+F12', platform: 'win32' },
  { command_id: 'edit.peekDefinition', key_combination: 'Alt+F12', platform: 'win32' },
  { command_id: 'edit.findAllReferences', key_combination: 'Shift+F12', platform: 'win32' },
  { command_id: 'edit.renameSymbol', key_combination: 'F2', platform: 'win32' },
  { command_id: 'edit.renameSymbolPreview', key_combination: 'Ctrl+Shift+F2', platform: 'win32' },
  { command_id: 'edit.formatDocument', key_combination: 'Shift+Alt+F', platform: 'win32' },
  { command_id: 'view.splitEditorRight', key_combination: 'Ctrl+\\', platform: 'win32' },
  { command_id: 'view.toggleZenMode', key_combination: 'F11', platform: 'win32' },
  { command_id: 'markdown.openPreview', key_combination: 'Ctrl+Shift+V', platform: 'win32' },
  { command_id: 'app.checkForUpdates', key_combination: 'Ctrl+Shift+U', platform: 'win32' },
  { command_id: 'file.newFile', key_combination: 'Ctrl+N', platform: 'linux' },
  { command_id: 'file.newFolder', key_combination: 'Ctrl+Shift+N', platform: 'linux' },
  { command_id: 'file.openFolder', key_combination: 'Ctrl+O', platform: 'linux' },
  { command_id: 'file.saveFile', key_combination: 'Ctrl+S', platform: 'linux' },
  { command_id: 'file.closeFile', key_combination: 'Ctrl+W', platform: 'linux' },
  { command_id: 'file.exit', key_combination: 'Alt+F4', platform: 'linux' },
  { command_id: 'edit.undo', key_combination: 'Ctrl+Z', platform: 'linux' },
  { command_id: 'edit.redo', key_combination: 'Ctrl+Y', platform: 'linux' },
  { command_id: 'edit.cut', key_combination: 'Ctrl+X', platform: 'linux' },
  { command_id: 'edit.copy', key_combination: 'Ctrl+C', platform: 'linux' },
  { command_id: 'edit.paste', key_combination: 'Ctrl+V', platform: 'linux' },
  { command_id: 'view.explorer', key_combination: 'Ctrl+Shift+E', platform: 'linux' },
  { command_id: 'view.git', key_combination: 'Ctrl+Shift+G', platform: 'linux' },
  { command_id: 'view.settings', key_combination: 'Ctrl+Shift+I', platform: 'linux' },
  { command_id: 'terminal.new', key_combination: 'Ctrl+Shift+`', platform: 'linux' },
  { command_id: 'terminal.toggle', key_combination: 'Ctrl+`', platform: 'linux' },
  { command_id: 'window.reload', key_combination: 'Ctrl+R', platform: 'linux' },
  { command_id: 'help.devtools', key_combination: 'F12', platform: 'linux' },
  { command_id: 'edit.goToDefinition', key_combination: 'Ctrl+F12', platform: 'linux' },
  { command_id: 'edit.peekDefinition', key_combination: 'Alt+F12', platform: 'linux' },
  { command_id: 'edit.findAllReferences', key_combination: 'Shift+F12', platform: 'linux' },
  { command_id: 'edit.renameSymbol', key_combination: 'F2', platform: 'linux' },
  { command_id: 'edit.renameSymbolPreview', key_combination: 'Ctrl+Shift+F2', platform: 'linux' },
  { command_id: 'edit.formatDocument', key_combination: 'Shift+Alt+F', platform: 'linux' },
  { command_id: 'view.splitEditorRight', key_combination: 'Ctrl+\\', platform: 'linux' },
  { command_id: 'view.toggleZenMode', key_combination: 'F11', platform: 'linux' },
  { command_id: 'markdown.openPreview', key_combination: 'Ctrl+Shift+V', platform: 'linux' },
  { command_id: 'app.checkForUpdates', key_combination: 'Ctrl+Shift+U', platform: 'linux' },
  { command_id: 'file.newFile', key_combination: 'Cmd+N', platform: 'darwin' },
  { command_id: 'file.newFolder', key_combination: 'Cmd+Shift+N', platform: 'darwin' },
  { command_id: 'file.openFolder', key_combination: 'Cmd+O', platform: 'darwin' },
  { command_id: 'file.saveFile', key_combination: 'Cmd+S', platform: 'darwin' },
  { command_id: 'file.closeFile', key_combination: 'Cmd+W', platform: 'darwin' },
  { command_id: 'file.exit', key_combination: 'Cmd+Q', platform: 'darwin' },
  { command_id: 'edit.undo', key_combination: 'Cmd+Z', platform: 'darwin' },
  { command_id: 'edit.redo', key_combination: 'Cmd+Shift+Z', platform: 'darwin' },
  { command_id: 'edit.cut', key_combination: 'Cmd+X', platform: 'darwin' },
  { command_id: 'edit.copy', key_combination: 'Cmd+C', platform: 'darwin' },
  { command_id: 'edit.paste', key_combination: 'Cmd+V', platform: 'darwin' },
  { command_id: 'view.explorer', key_combination: 'Cmd+Shift+E', platform: 'darwin' },
  { command_id: 'view.git', key_combination: 'Cmd+Shift+G', platform: 'darwin' },
  { command_id: 'view.settings', key_combination: 'Cmd+Shift+I', platform: 'darwin' },
  { command_id: 'terminal.new', key_combination: 'Cmd+Shift+`', platform: 'darwin' },
  { command_id: 'terminal.toggle', key_combination: 'Cmd+`', platform: 'darwin' },
  { command_id: 'window.reload', key_combination: 'Cmd+R', platform: 'darwin' },
  { command_id: 'help.devtools', key_combination: 'F12', platform: 'darwin' },
  { command_id: 'edit.goToDefinition', key_combination: 'Ctrl+F12', platform: 'darwin' },
  { command_id: 'edit.peekDefinition', key_combination: 'Option+F12', platform: 'darwin' },
  { command_id: 'edit.findAllReferences', key_combination: 'Shift+F12', platform: 'darwin' },
  { command_id: 'edit.renameSymbol', key_combination: 'F2', platform: 'darwin' },
  { command_id: 'edit.renameSymbolPreview', key_combination: 'Cmd+Shift+F2', platform: 'darwin' },
  { command_id: 'edit.formatDocument', key_combination: 'Shift+Option+F', platform: 'darwin' },
  { command_id: 'view.splitEditorRight', key_combination: 'Cmd+\\', platform: 'darwin' },
  { command_id: 'view.toggleZenMode', key_combination: 'F11', platform: 'darwin' },
  { command_id: 'markdown.openPreview', key_combination: 'Cmd+Shift+V', platform: 'darwin' },
  { command_id: 'app.checkForUpdates', key_combination: 'Cmd+Shift+U', platform: 'darwin' },
];

export class DatabaseService implements IDatabaseService {
  static readonly inject = [ILogService] as const;
  constructor(private readonly logService: ILogService) {}

  // sql.js has no real type declarations in this project (see sql.d.ts's blanket `declare module 'sql.js';`); real types are a legitimate future improvement, kept separate from this migration.
  private db: any = null;
  private dbPath = '';
  private inTransaction = false;

  async initialize(dbFilePath: string): Promise<void> {
    this.dbPath = dbFilePath;
    const SQL = await initSqlJs();

    if (fs.existsSync(dbFilePath)) {
      try {
        const fileBuffer = fs.readFileSync(dbFilePath);
        const candidate = new SQL.Database(fileBuffer);
        // sql.js doesn't validate the buffer in the constructor — a corrupt file only throws once queried, so check here inside the try/catch.
        candidate.exec('SELECT 1');
        this.db = candidate;
        this.logService.info('Database loaded successfully from:', dbFilePath);
      } catch (err) {
        this.logService.error('Failed to load database file, initializing empty database:', err);
        this.db = new SQL.Database();
      }
    } else {
      this.logService.info('Database file does not exist, creating new instance.');
      this.db = new SQL.Database();
    }

    this.runMigrations();
  }

  queryAll<T>(sql: string, params: unknown[] = []): T[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    stmt.bind(params as never[]);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const rows = this.queryAll<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  run(sql: string, params: unknown[] = []): void {
    if (!this.db) return;
    const stmt = this.db.prepare(sql);
    stmt.run(params as never[]);
    stmt.free();
    if (!this.inTransaction) this.saveToDisk();
  }

  transaction<T>(fn: () => T): T {
    if (!this.db) return fn();
    this.inTransaction = true;
    this.db.run('BEGIN TRANSACTION');
    let result: T;
    try {
      result = fn();
    } catch (err) {
      this.db.run('ROLLBACK');
      this.inTransaction = false;
      throw err;
    }
    this.db.run('COMMIT');
    this.inTransaction = false;
    this.saveToDisk();
    return result;
  }

  private saveToDisk(): void {
    if (!this.db || !this.dbPath) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err) {
      this.logService.error('Failed to persist database to disk:', err);
    }
  }

  private runMigrations(): void {
    const db = this.db!;
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS feature_flags (name TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', is_enabled INTEGER DEFAULT 0, description TEXT, updated_at INTEGER, PRIMARY KEY (name, project_id));`);
    // Pre-workspace-scoping installs lack project_id; SQLite can't ALTER a PRIMARY KEY in place, so migrate via rename/recreate/copy/drop.
    const flagColumns = this.queryAll<{ name: string }>(`PRAGMA table_info(feature_flags)`).map((c) => c.name);
    if (!flagColumns.includes('project_id')) {
      db.run(`ALTER TABLE feature_flags RENAME TO feature_flags_legacy`);
      db.run(`CREATE TABLE feature_flags (name TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', is_enabled INTEGER DEFAULT 0, description TEXT, updated_at INTEGER, PRIMARY KEY (name, project_id));`);
      db.run(`INSERT INTO feature_flags (name, project_id, is_enabled, description, updated_at) SELECT name, '', is_enabled, description, updated_at FROM feature_flags_legacy`);
      db.run(`DROP TABLE feature_flags_legacy`);
    }
    db.run(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, path TEXT UNIQUE, last_opened INTEGER);`);
    // trust_state added later (Workspace Trust) — ADD COLUMN is safe here since it's a plain nullable column, unlike feature_flags' PRIMARY KEY change above.
    const projectColumns = this.queryAll<{ name: string }>(`PRAGMA table_info(projects)`).map((c) => c.name);
    if (!projectColumns.includes('trust_state')) {
      db.run(`ALTER TABLE projects ADD COLUMN trust_state TEXT`);
    }
    db.run(`CREATE TABLE IF NOT EXISTS project_memories (id TEXT PRIMARY KEY, project_id TEXT, memory_key TEXT, memory_val TEXT, created_at INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS project_memory (id TEXT PRIMARY KEY, project_id TEXT, memory_key TEXT, memory_val TEXT, created_at INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS project_rules (id TEXT PRIMARY KEY, project_id TEXT, rule_text TEXT, is_active INTEGER DEFAULT 1);`);
    db.run(`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, messages TEXT, updated_at INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, description TEXT, steps TEXT, created_at INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS command_history (id TEXT PRIMARY KEY, project_id TEXT, command TEXT, executed_at INTEGER, exit_code INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS project_index (id TEXT PRIMARY KEY, project_id TEXT, file_path TEXT, file_type TEXT, content_hash TEXT, symbols TEXT, indexed_at INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, source TEXT DEFAULT 'core');`);
    db.run(`CREATE TABLE IF NOT EXISTS keybindings (command_id TEXT, key_combination TEXT NOT NULL, platform TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'default', PRIMARY KEY (command_id, platform, profile_id));`);
    db.run(`CREATE TABLE IF NOT EXISTS extensions (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT, description TEXT, publisher TEXT, source_type TEXT DEFAULT 'marketplace', is_enabled INTEGER DEFAULT 1, provides TEXT, depends_on TEXT, categories TEXT, tags TEXT, manifest_json TEXT);`);
    // CREATE TABLE IF NOT EXISTS is a no-op on an already-existing extensions table, so newly added columns need an explicit migration here.
    const extensionColumns = this.queryAll<{ name: string }>(`PRAGMA table_info(extensions)`).map((c) => c.name);
    if (!extensionColumns.includes('categories')) {
      db.run(`ALTER TABLE extensions ADD COLUMN categories TEXT`);
    }
    if (!extensionColumns.includes('tags')) {
      db.run(`ALTER TABLE extensions ADD COLUMN tags TEXT`);
    }
    db.run(`CREATE TABLE IF NOT EXISTS extension_settings (extension_id TEXT, key TEXT, value TEXT, PRIMARY KEY (extension_id, key));`);
    db.run(`CREATE TABLE IF NOT EXISTS extension_workspace_state (extension_id TEXT NOT NULL, project_id TEXT NOT NULL, is_enabled INTEGER NOT NULL, PRIMARY KEY (extension_id, project_id));`);
    db.run(`CREATE TABLE IF NOT EXISTS status_bar_items (id TEXT PRIMARY KEY, source TEXT NOT NULL, visible INTEGER DEFAULT 1, position TEXT DEFAULT 'left', priority INTEGER DEFAULT 100, profile_id TEXT NOT NULL DEFAULT 'default');`);
    db.run(`CREATE TABLE IF NOT EXISTS symbols (id TEXT PRIMARY KEY, project_id TEXT, file_path TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, line_number INTEGER, column_number INTEGER, container_name TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, project_id TEXT, file_path TEXT, module_name TEXT NOT NULL, imported_symbols TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS [references] (id TEXT PRIMARY KEY, project_id TEXT, symbol_name TEXT NOT NULL, file_path TEXT, line_number INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS components (id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, file_path TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, file_path TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, project_id TEXT, path_pattern TEXT NOT NULL, handler TEXT, file_path TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS frontend_call_sites (id TEXT PRIMARY KEY, project_id TEXT, file_path TEXT, method TEXT, url_pattern TEXT NOT NULL, caller_symbol TEXT, line_number INTEGER);`);
    db.run(`CREATE TABLE IF NOT EXISTS themes (id TEXT PRIMARY KEY, name TEXT NOT NULL, label TEXT, bg_primary TEXT, bg_secondary TEXT, bg_tertiary TEXT, border_color TEXT, accent_color TEXT, accent_secondary TEXT, text_primary TEXT, text_secondary TEXT, text_muted TEXT, is_default INTEGER DEFAULT 0);`);
    db.run(`CREATE TABLE IF NOT EXISTS file_history (id TEXT PRIMARY KEY, workspace_path TEXT NOT NULL, file_path TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL);`);
    // Keybinding profiles — `profile_id` was already an FK-like column on keybindings/status_bar_items with no backing table; this is that missing "list of profiles" side.
    db.run(`CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    // Extends the same "override layer on a global baseline" shape extension_workspace_state uses to settings/extensions; the 'default' profile never gets a row here, it reads the global baseline directly.
    db.run(`CREATE TABLE IF NOT EXISTS settings_profile_overrides (profile_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (profile_id, key));`);
    db.run(`CREATE TABLE IF NOT EXISTS extension_profile_state (profile_id TEXT NOT NULL, extension_id TEXT NOT NULL, is_enabled INTEGER NOT NULL, PRIMARY KEY (profile_id, extension_id));`);

    // Wrapped in transaction() — without it, each of the ~90+ this.run() calls below independently triggers a full disk flush, exactly the O(n^2) cost transaction() exists to avoid.
    this.transaction(() => {
      for (const flag of DEFAULT_FEATURE_FLAGS) {
        const exists = this.queryOne("SELECT 1 FROM feature_flags WHERE name = ? AND project_id = ''", [flag.name]);
        if (!exists) {
          this.run("INSERT INTO feature_flags (name, project_id, is_enabled, description, updated_at) VALUES (?, '', ?, ?, ?)", [
            flag.name,
            flag.is_enabled,
            flag.description,
            Date.now(),
          ]);
        }
      }

      for (const cmd of DEFAULT_COMMANDS) {
        const exists = this.queryOne('SELECT 1 FROM commands WHERE id = ?', [cmd.id]);
        if (!exists) {
          this.run('INSERT INTO commands (id, name, category, description, source) VALUES (?, ?, ?, ?, ?)', [
            cmd.id,
            cmd.name,
            cmd.category,
            cmd.description,
            cmd.source,
          ]);
        }
      }

      for (const kb of DEFAULT_KEYBINDINGS) {
        const exists = this.queryOne(
          'SELECT 1 FROM keybindings WHERE command_id = ? AND platform = ? AND profile_id = "default"',
          [kb.command_id, kb.platform],
        );
        if (!exists) {
          this.run('INSERT INTO keybindings (command_id, key_combination, platform, profile_id) VALUES (?, ?, ?, "default")', [
            kb.command_id,
            kb.key_combination,
            kb.platform,
          ]);
        }
      }

      const defaultProfileExists = this.queryOne("SELECT 1 FROM profiles WHERE id = 'default'");
      if (!defaultProfileExists) {
        this.run("INSERT INTO profiles (id, name, created_at) VALUES ('default', 'Default', ?)", [Date.now()]);
      }
    });
  }

  getFeatureFlags(): FeatureFlagRow[] {
    return this.queryAll('SELECT name, is_enabled, description, updated_at FROM feature_flags');
  }

  getEffectiveFeatureFlags(projectId: string): EffectiveFeatureFlagRow[] {
    const globalRows = this.queryAll<FeatureFlagRow>(
      "SELECT name, is_enabled, description, updated_at FROM feature_flags WHERE project_id = ''",
    );
    const overrides = projectId
      ? this.queryAll<{ name: string; is_enabled: number }>(
          'SELECT name, is_enabled FROM feature_flags WHERE project_id = ?',
          [projectId],
        )
      : [];
    const overrideMap = new Map(overrides.map((o) => [o.name, o.is_enabled]));
    return globalRows.map((row) => ({
      name: row.name,
      description: row.description,
      user_enabled: row.is_enabled,
      workspace_enabled: overrideMap.has(row.name) ? overrideMap.get(row.name)! : null,
    }));
  }

  setFeatureFlag(name: string, isEnabled: boolean, projectId = ''): boolean {
    const description =
      this.queryOne<{ description: string }>("SELECT description FROM feature_flags WHERE name = ? AND project_id = ''", [name])
        ?.description || '';
    this.run(
      'INSERT OR REPLACE INTO feature_flags (name, project_id, is_enabled, description, updated_at) VALUES (?, ?, ?, ?, ?)',
      [name, projectId, isEnabled ? 1 : 0, description, Date.now()],
    );
    return true;
  }

  clearWorkspaceFlagOverride(name: string, projectId: string): boolean {
    this.run('DELETE FROM feature_flags WHERE name = ? AND project_id = ?', [name, projectId]);
    return true;
  }

  getSettings(profileId?: string): SettingsMap {
    const rows = this.queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');
    const settings: SettingsMap = {};
    rows.forEach((r) => {
      settings[r.key] = r.value;
    });
    if (profileId && profileId !== 'default') {
      const overrides = this.queryAll<{ key: string; value: string }>(
        'SELECT key, value FROM settings_profile_overrides WHERE profile_id = ?',
        [profileId],
      );
      overrides.forEach((r) => {
        settings[r.key] = r.value;
      });
    }
    return settings;
  }

  setSetting(key: string, value: string, profileId?: string): boolean {
    if (!profileId || profileId === 'default') {
      this.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    } else {
      this.run('INSERT OR REPLACE INTO settings_profile_overrides (profile_id, key, value) VALUES (?, ?, ?)', [profileId, key, value]);
    }
    return true;
  }

  getConversations(projectId: string): ConversationRow[] {
    return this.queryAll(
      'SELECT id, project_id, title, messages, updated_at FROM conversations WHERE project_id = ? ORDER BY updated_at DESC',
      [projectId],
    );
  }

  getSymbols(projectId: string): SymbolRow[] {
    return this.queryAll('SELECT * FROM symbols WHERE project_id = ?', [projectId]);
  }

  getImports(projectId: string): ImportRow[] {
    return this.queryAll('SELECT * FROM imports WHERE project_id = ?', [projectId]);
  }

  getRoutes(projectId: string): RouteRow[] {
    return this.queryAll('SELECT * FROM routes WHERE project_id = ?', [projectId]);
  }

  getFrontendCallSites(projectId: string): FrontendCallSiteRow[] {
    return this.queryAll('SELECT * FROM frontend_call_sites WHERE project_id = ?', [projectId]);
  }

  saveConversation(id: string, projectId: string, title: string, messages: string): boolean {
    this.run('INSERT OR REPLACE INTO conversations (id, project_id, title, messages, updated_at) VALUES (?, ?, ?, ?, ?)', [
      id,
      projectId,
      title,
      messages,
      Date.now(),
    ]);
    return true;
  }

  deleteConversation(id: string): boolean {
    this.run('DELETE FROM conversations WHERE id = ?', [id]);
    return true;
  }

  getProjectRules(projectId: string): ProjectRuleRow[] {
    return this.queryAll('SELECT id, project_id, rule_text, is_active FROM project_rules WHERE project_id = ? ORDER BY rowid', [
      projectId,
    ]);
  }

  saveProjectRule(id: string, projectId: string, ruleText: string): boolean {
    // Upsert that preserves is_active on edit — a plain INSERT OR REPLACE would silently re-enable a rule the user had toggled off.
    this.run(
      `INSERT OR REPLACE INTO project_rules (id, project_id, rule_text, is_active)
       VALUES (?, ?, ?, COALESCE((SELECT is_active FROM project_rules WHERE id = ?), 1))`,
      [id, projectId, ruleText, id],
    );
    return true;
  }

  setProjectRuleActive(id: string, isActive: boolean): boolean {
    this.run('UPDATE project_rules SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
    return true;
  }

  deleteProjectRule(id: string): boolean {
    this.run('DELETE FROM project_rules WHERE id = ?', [id]);
    return true;
  }

  getProjectMemories(projectId: string): ProjectMemoryRow[] {
    return this.queryAll(
      'SELECT id, project_id, memory_key, memory_val, created_at FROM project_memory WHERE project_id = ? ORDER BY created_at',
      [projectId],
    );
  }

  saveProjectMemory(id: string, projectId: string, memoryKey: string, memoryVal: string): boolean {
    // Upsert preserving created_at on edit, so the memory list keeps a stable order instead of edited entries jumping to the bottom.
    this.run(
      `INSERT OR REPLACE INTO project_memory (id, project_id, memory_key, memory_val, created_at)
       VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM project_memory WHERE id = ?), ?))`,
      [id, projectId, memoryKey, memoryVal, id, Date.now()],
    );
    return true;
  }

  deleteProjectMemory(id: string): boolean {
    this.run('DELETE FROM project_memory WHERE id = ?', [id]);
    return true;
  }

  getProjects(): ProjectRow[] {
    return this.queryAll('SELECT id, name, path, last_opened, trust_state FROM projects ORDER BY last_opened DESC');
  }

  addProject(id: string, name: string, pathStr: string): boolean {
    // ON CONFLICT rather than INSERT OR REPLACE, which deletes+reinserts and would silently wipe trust_state back to NULL on reopen.
    this.run(
      `INSERT INTO projects (id, name, path, last_opened, trust_state) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened = excluded.last_opened`,
      [id, name, pathStr, Date.now()],
    );
    return true;
  }

  getProjectTrustState(pathStr: string): 'trusted' | 'restricted' | null {
    const row = this.queryOne<{ trust_state: string | null }>('SELECT trust_state FROM projects WHERE path = ?', [pathStr]);
    return (row?.trust_state as 'trusted' | 'restricted' | null) ?? null;
  }

  setProjectTrustState(pathStr: string, state: 'trusted' | 'restricted'): boolean {
    // Callers can set trust before a `projects` row exists for this path — upsert rather than assume addProject() already ran.
    const existing = this.queryOne<{ id: string }>('SELECT id FROM projects WHERE path = ?', [pathStr]);
    if (existing) {
      this.run('UPDATE projects SET trust_state = ? WHERE path = ?', [state, pathStr]);
    } else {
      const id = 'proj_' + Math.random().toString(36).substring(2, 11);
      const name = pathStr.split(/[\\/]/).pop() || pathStr;
      this.run('INSERT INTO projects (id, name, path, last_opened, trust_state) VALUES (?, ?, ?, ?, ?)', [id, name, pathStr, Date.now(), state]);
    }
    return true;
  }

  getCommands(): CommandRow[] {
    return this.queryAll('SELECT id, name, category, description, source FROM commands');
  }

  getKeybindings(platform: string, profileId = 'default'): KeybindingRow[] {
    return this.queryAll(
      'SELECT command_id, key_combination, platform, profile_id FROM keybindings WHERE platform = ? AND profile_id = ?',
      [platform, profileId],
    );
  }

  setKeybinding(commandId: string, keyCombination: string, platform: string, profileId = 'default'): boolean {
    this.run('DELETE FROM keybindings WHERE command_id = ? AND platform = ? AND profile_id = ?', [commandId, platform, profileId]);
    if (keyCombination.trim() !== '') {
      this.run('INSERT OR REPLACE INTO keybindings (command_id, key_combination, platform, profile_id) VALUES (?, ?, ?, ?)', [
        commandId,
        keyCombination,
        platform,
        profileId,
      ]);
    }
    return true;
  }

  resetKeybindings(platform: string, profileId = 'default'): boolean {
    this.run('DELETE FROM keybindings WHERE platform = ? AND profile_id = ?', [platform, profileId]);
    for (const kb of DEFAULT_KEYBINDINGS) {
      if (kb.platform === platform) {
        this.run('INSERT INTO keybindings (command_id, key_combination, platform, profile_id) VALUES (?, ?, ?, ?)', [
          kb.command_id,
          kb.key_combination,
          kb.platform,
          profileId,
        ]);
      }
    }
    return true;
  }

  getProfiles(): ProfileRow[] {
    return this.queryAll('SELECT id, name, created_at FROM profiles ORDER BY created_at ASC');
  }

  createProfile(id: string, name: string): boolean {
    const exists = this.queryOne('SELECT 1 FROM profiles WHERE id = ?', [id]);
    if (exists) return false;
    this.run('INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)', [id, name, Date.now()]);
    // Seeded with DEFAULT_KEYBINDINGS for every platform, not just the caller's — a brand-new profile with zero keybindings would break basics like Ctrl+S the instant it's switched to.
    const platforms = [...new Set(DEFAULT_KEYBINDINGS.map((kb) => kb.platform))];
    for (const platform of platforms) {
      this.resetKeybindings(platform, id);
    }
    return true;
  }

  renameProfile(id: string, name: string): boolean {
    if (id === 'default') return false;
    const exists = this.queryOne('SELECT 1 FROM profiles WHERE id = ?', [id]);
    if (!exists) return false;
    this.run('UPDATE profiles SET name = ? WHERE id = ?', [name, id]);
    return true;
  }

  deleteProfile(id: string): boolean {
    if (id === 'default') return false;
    const exists = this.queryOne('SELECT 1 FROM profiles WHERE id = ?', [id]);
    if (!exists) return false;
    this.run('DELETE FROM profiles WHERE id = ?', [id]);
    this.run('DELETE FROM keybindings WHERE profile_id = ?', [id]);
    this.run('DELETE FROM settings_profile_overrides WHERE profile_id = ?', [id]);
    this.run('DELETE FROM extension_profile_state WHERE profile_id = ?', [id]);
    return true;
  }

  getExtensions(profileId?: string): ExtensionRow[] {
    const rows = this.queryAll<ExtensionRow>(
      'SELECT id, name, version, description, publisher, source_type, is_enabled, provides, depends_on, categories, tags, manifest_json FROM extensions',
    );
    if (!profileId || profileId === 'default') return rows;
    const overrides = this.queryAll<{ extension_id: string; is_enabled: number }>(
      'SELECT extension_id, is_enabled FROM extension_profile_state WHERE profile_id = ?',
      [profileId],
    );
    const overrideMap = new Map(overrides.map((o) => [o.extension_id, o.is_enabled]));
    return rows.map((r) => (overrideMap.has(r.id) ? { ...r, is_enabled: overrideMap.get(r.id)! } : r));
  }

  setExtensionEnabled(id: string, isEnabled: boolean, profileId?: string): boolean {
    if (!profileId || profileId === 'default') {
      this.run('UPDATE extensions SET is_enabled = ? WHERE id = ?', [isEnabled ? 1 : 0, id]);
    } else {
      this.run('INSERT OR REPLACE INTO extension_profile_state (profile_id, extension_id, is_enabled) VALUES (?, ?, ?)', [
        profileId,
        id,
        isEnabled ? 1 : 0,
      ]);
    }
    return true;
  }

  saveExtension(ext: SaveExtensionInput): boolean {
    this.run(
      'INSERT OR REPLACE INTO extensions (id, name, version, description, publisher, source_type, is_enabled, provides, depends_on, categories, tags, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        ext.id,
        ext.name,
        ext.version,
        ext.description || '',
        ext.publisher || '',
        ext.type || ext.source_type || 'marketplace',
        (ext.isEnabled ?? true) ? 1 : 0,
        typeof ext.provides === 'string' ? ext.provides : JSON.stringify(ext.provides || []),
        typeof ext.dependsOn === 'string' ? ext.dependsOn : JSON.stringify(ext.dependsOn || []),
        typeof ext.categories === 'string' ? ext.categories : JSON.stringify(ext.categories || []),
        typeof ext.tags === 'string' ? ext.tags : JSON.stringify(ext.tags || []),
        ext.manifestJson || ext.manifest_json || '',
      ],
    );
    return true;
  }

  deleteExtension(id: string): boolean {
    this.run('DELETE FROM extensions WHERE id = ?', [id]);
    return true;
  }

  getWorkspaceExtensionOverrides(projectId: string): Record<string, boolean> {
    const rows = this.queryAll<{ extension_id: string; is_enabled: number }>(
      'SELECT extension_id, is_enabled FROM extension_workspace_state WHERE project_id = ?',
      [projectId],
    );
    const map: Record<string, boolean> = {};
    rows.forEach((r) => { map[r.extension_id] = r.is_enabled === 1; });
    return map;
  }

  setWorkspaceExtensionEnabled(extensionId: string, projectId: string, isEnabled: boolean): boolean {
    this.run(
      'INSERT OR REPLACE INTO extension_workspace_state (extension_id, project_id, is_enabled) VALUES (?, ?, ?)',
      [extensionId, projectId, isEnabled ? 1 : 0],
    );
    return true;
  }

  clearWorkspaceExtensionOverride(extensionId: string, projectId: string): boolean {
    this.run('DELETE FROM extension_workspace_state WHERE extension_id = ? AND project_id = ?', [extensionId, projectId]);
    return true;
  }

  getThemes(): ThemeRow[] {
    return this.queryAll(
      'SELECT id, name, label, bg_primary, bg_secondary, bg_tertiary, border_color, accent_color, accent_secondary, text_primary, text_secondary, text_muted, is_default FROM themes',
    );
  }

  saveTheme(t: SaveThemeInput): boolean {
    this.run(
      'INSERT OR REPLACE INTO themes (id, name, label, bg_primary, bg_secondary, bg_tertiary, border_color, accent_color, accent_secondary, text_primary, text_secondary, text_muted, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        t.id,
        t.name,
        t.label || t.name,
        t.bgPrimary,
        t.bgSecondary,
        t.bgTertiary,
        t.borderColor,
        t.accentColor,
        t.accentSecondary,
        t.textPrimary,
        t.textSecondary,
        t.textMuted,
        t.isDefault ? 1 : 0,
      ],
    );
    return true;
  }

  saveFileSnapshot(workspacePath: string, filePath: string, content: string): boolean {
    const latest = this.queryOne<{ content: string }>(
      'SELECT content FROM file_history WHERE workspace_path = ? AND file_path = ? ORDER BY timestamp DESC LIMIT 1',
      [workspacePath, filePath],
    );
    if (latest && latest.content === content) return true;

    const id = 'snap_' + Math.random().toString(36).substring(2, 11);
    this.run('INSERT INTO file_history (id, workspace_path, file_path, content, timestamp) VALUES (?, ?, ?, ?, ?)', [
      id,
      workspacePath,
      filePath,
      content,
      Date.now(),
    ]);
    this.run(
      `DELETE FROM file_history WHERE workspace_path = ? AND file_path = ? AND id NOT IN (
         SELECT id FROM file_history WHERE workspace_path = ? AND file_path = ? ORDER BY timestamp DESC LIMIT 50
       )`,
      [workspacePath, filePath, workspacePath, filePath],
    );
    return true;
  }

  getFileHistory(workspacePath: string, filePath: string): FileHistoryEntry[] {
    return this.queryAll(
      'SELECT id, timestamp FROM file_history WHERE workspace_path = ? AND file_path = ? ORDER BY timestamp DESC',
      [workspacePath, filePath],
    );
  }

  getFileSnapshotContent(id: string): string | null {
    const row = this.queryOne<{ content: string }>('SELECT content FROM file_history WHERE id = ?', [id]);
    return row?.content ?? null;
  }
}
