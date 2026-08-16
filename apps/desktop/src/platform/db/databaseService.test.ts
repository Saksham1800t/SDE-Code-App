import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseService } from './databaseService';
import { FakeLogService } from '../log';

describe('DatabaseService', () => {
  let tmpDir: string;
  let dbPath: string;
  let log: FakeLogService;
  let service: DatabaseService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-db-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    log = new FakeLogService();
    service = new DatabaseService(log);
    await service.initialize(dbPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initialize() seeds default feature flags, commands, and keybindings', () => {
    const flags = service.getFeatureFlags();
    expect(flags.some((f) => f.name === 'auto-save' && f.is_enabled === 1)).toBe(true);

    const commands = service.getCommands();
    expect(commands.some((c) => c.id === 'file.newFile')).toBe(true);

    const keybindings = service.getKeybindings('win32');
    expect(keybindings.some((k) => k.command_id === 'file.saveFile' && k.key_combination === 'Ctrl+S')).toBe(true);
  });

  it('initialize() persists to disk — a second instance reads back what the first wrote', async () => {
    service.setSetting('theme', 'dracula');

    const second = new DatabaseService(new FakeLogService());
    await second.initialize(dbPath);

    expect(second.getSettings()).toMatchObject({ theme: 'dracula' });
  });

  it('setFeatureFlag toggles is_enabled', () => {
    service.setFeatureFlag('ai-autocomplete', true);
    const flags = service.getFeatureFlags();
    expect(flags.find((f) => f.name === 'ai-autocomplete')?.is_enabled).toBe(1);
  });

  it('getEffectiveFeatureFlags reports workspace_enabled=null when no override exists for that project', () => {
    const effective = service.getEffectiveFeatureFlags('projA');
    const flag = effective.find((f) => f.name === 'auto-save');
    expect(flag).toMatchObject({ user_enabled: 1, workspace_enabled: null });
  });

  it('setFeatureFlag(name, value, projectId) writes a workspace override without touching the global (User) row', () => {
    service.setFeatureFlag('auto-save', false, 'projA');

    const effectiveA = service.getEffectiveFeatureFlags('projA');
    expect(effectiveA.find((f) => f.name === 'auto-save')).toMatchObject({ user_enabled: 1, workspace_enabled: 0 });

    // A different workspace (or User scope) is unaffected.
    const effectiveB = service.getEffectiveFeatureFlags('projB');
    expect(effectiveB.find((f) => f.name === 'auto-save')).toMatchObject({ user_enabled: 1, workspace_enabled: null });
  });

  it('clearWorkspaceFlagOverride deletes just the override row, reverting to the User value', () => {
    service.setFeatureFlag('auto-save', false, 'projA');
    service.clearWorkspaceFlagOverride('auto-save', 'projA');

    const effective = service.getEffectiveFeatureFlags('projA');
    expect(effective.find((f) => f.name === 'auto-save')).toMatchObject({ user_enabled: 1, workspace_enabled: null });
  });

  it('migrates a pre-workspace-scoping feature_flags table (single-column PK) without losing data', async () => {
    // Simulate an existing install's DB file: old schema, no project_id column.
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const legacyDb = new SQL.Database();
    legacyDb.run('CREATE TABLE feature_flags (name TEXT PRIMARY KEY, is_enabled INTEGER DEFAULT 0, description TEXT, updated_at INTEGER);');
    legacyDb.run("INSERT INTO feature_flags (name, is_enabled, description, updated_at) VALUES ('auto-save', 0, 'legacy desc', 123);");
    fs.writeFileSync(dbPath, Buffer.from(legacyDb.export()));
    legacyDb.close();

    const migrated = new DatabaseService(new FakeLogService());
    await migrated.initialize(dbPath);

    // The pre-existing row survived the migration, scoped to global (project_id='').
    const effective = migrated.getEffectiveFeatureFlags('any-project');
    expect(effective.find((f) => f.name === 'auto-save')).toMatchObject({ user_enabled: 0, description: 'legacy desc' });
    // Other default flags were still seeded normally alongside the migrated row.
    expect(effective.some((f) => f.name === 'git-heatmap')).toBe(true);
  });

  it('settings round-trip through setSetting/getSettings', () => {
    service.setSetting('gemini-key', 'abc123');
    expect(service.getSettings()).toMatchObject({ 'gemini-key': 'abc123' });
  });

  describe('Profile-scoped settings and extensions (Phase 28)', () => {
    it('a non-default profile\'s setSetting overrides that key only for that profile, leaving the global value untouched', () => {
      service.setSetting('ide-editor-font-size', '14');
      service.createProfile('work', 'Work');
      service.setSetting('ide-editor-font-size', '18', 'work');

      expect(service.getSettings()['ide-editor-font-size']).toBe('14');
      expect(service.getSettings('default')['ide-editor-font-size']).toBe('14');
      expect(service.getSettings('work')['ide-editor-font-size']).toBe('18');
    });

    it('a profile with no override for a key falls back to the global value', () => {
      service.setSetting('ide-editor-tab-size', '2');
      service.createProfile('work', 'Work');

      expect(service.getSettings('work')['ide-editor-tab-size']).toBe('2');
    });

    it('deleteProfile removes that profile\'s settings overrides', () => {
      service.setSetting('ide-editor-font-size', '14');
      service.createProfile('work', 'Work');
      service.setSetting('ide-editor-font-size', '18', 'work');
      service.deleteProfile('work');

      service.createProfile('work', 'Work');
      expect(service.getSettings('work')['ide-editor-font-size']).toBe('14');
    });

    it('getExtensions/setExtensionEnabled with no profileId (or "default") reads/writes the global is_enabled column', () => {
      service.saveExtension({ id: 'sys.test', name: 'Test', version: '1.0.0', publisher: 'Test', isEnabled: true, provides: [], dependsOn: [] });
      service.createProfile('work', 'Work');
      service.setExtensionEnabled('sys.test', false, 'work');

      expect(service.getExtensions().find((e) => e.id === 'sys.test')?.is_enabled).toBe(1);
      expect(service.getExtensions('default').find((e) => e.id === 'sys.test')?.is_enabled).toBe(1);
    });

    it('a non-default profile\'s setExtensionEnabled overrides is_enabled only for that profile', () => {
      service.saveExtension({ id: 'sys.test', name: 'Test', version: '1.0.0', publisher: 'Test', isEnabled: true, provides: [], dependsOn: [] });
      service.createProfile('work', 'Work');
      service.setExtensionEnabled('sys.test', false, 'work');

      expect(service.getExtensions('work').find((e) => e.id === 'sys.test')?.is_enabled).toBe(0);
      expect(service.getExtensions().find((e) => e.id === 'sys.test')?.is_enabled).toBe(1);
    });

    it('an extension with no profile override falls back to its global is_enabled', () => {
      service.saveExtension({ id: 'sys.other', name: 'Other', version: '1.0.0', publisher: 'Test', isEnabled: true, provides: [], dependsOn: [] });
      service.createProfile('work', 'Work');

      expect(service.getExtensions('work').find((e) => e.id === 'sys.other')?.is_enabled).toBe(1);
    });

    it('deleteProfile removes that profile\'s extension overrides', () => {
      service.saveExtension({ id: 'sys.test', name: 'Test', version: '1.0.0', publisher: 'Test', isEnabled: true, provides: [], dependsOn: [] });
      service.createProfile('work', 'Work');
      service.setExtensionEnabled('sys.test', false, 'work');
      service.deleteProfile('work');

      service.createProfile('work', 'Work');
      expect(service.getExtensions('work').find((e) => e.id === 'sys.test')?.is_enabled).toBe(1);
    });
  });

  it('conversation CRUD works end to end', () => {
    service.saveConversation('conv1', 'proj1', 'My chat', '[]');
    expect(service.getConversations('proj1')).toHaveLength(1);

    service.deleteConversation('conv1');
    expect(service.getConversations('proj1')).toHaveLength(0);
  });

  it('Code Map read methods (Phase 34) return rows scoped to project_id, and [] for an unknown project', () => {
    service.run('INSERT INTO symbols (id, project_id, file_path, name, kind, line_number, column_number) VALUES (?, ?, ?, ?, ?, ?, ?)', ['sym1', 'proj1', 'src/a.ts', 'foo', 'function', 1, 1]);
    service.run('INSERT INTO symbols (id, project_id, file_path, name, kind, line_number, column_number) VALUES (?, ?, ?, ?, ?, ?, ?)', ['sym2', 'proj2', 'src/b.ts', 'bar', 'function', 1, 1]);
    service.run('INSERT INTO imports (id, project_id, file_path, module_name, imported_symbols) VALUES (?, ?, ?, ?, ?)', ['imp1', 'proj1', 'src/a.ts', './b', '["bar"]']);
    service.run('INSERT INTO routes (id, project_id, path_pattern, handler, file_path) VALUES (?, ?, ?, ?, ?)', ['route1', 'proj1', 'GET /api/users', 'getUsers', 'src/routes.ts']);
    service.run('INSERT INTO frontend_call_sites (id, project_id, file_path, method, url_pattern, caller_symbol, line_number) VALUES (?, ?, ?, ?, ?, ?, ?)', ['cs1', 'proj1', 'src/a.ts', 'get', '/api/users', 'foo', 3]);

    expect(service.getSymbols('proj1')).toHaveLength(1);
    expect(service.getSymbols('proj1')[0].name).toBe('foo');
    expect(service.getImports('proj1')).toHaveLength(1);
    expect(service.getRoutes('proj1')).toHaveLength(1);
    expect(service.getFrontendCallSites('proj1')).toHaveLength(1);
    expect(service.getFrontendCallSites('proj1')[0].caller_symbol).toBe('foo');

    expect(service.getSymbols('unknown-project')).toEqual([]);
    expect(service.getImports('unknown-project')).toEqual([]);
    expect(service.getRoutes('unknown-project')).toEqual([]);
    expect(service.getFrontendCallSites('unknown-project')).toEqual([]);
  });

  it('setKeybinding with an empty key combination clears the binding without re-adding it', () => {
    service.setKeybinding('file.saveFile', '', 'win32');
    expect(service.getKeybindings('win32').find((k) => k.command_id === 'file.saveFile')).toBeUndefined();
  });

  it('resetKeybindings restores the shipped defaults for that platform', () => {
    service.setKeybinding('file.saveFile', '', 'win32');
    service.resetKeybindings('win32');
    expect(service.getKeybindings('win32').find((k) => k.command_id === 'file.saveFile')?.key_combination).toBe('Ctrl+S');
  });

  it('saveExtension accepts the defensive camelCase/snake_case mix and round-trips through getExtensions', () => {
    service.saveExtension({
      id: 'sys.test',
      name: 'Test Extension',
      version: '1.0.0',
      publisher: 'Test',
      isEnabled: true,
      provides: ['theme'],
      dependsOn: [],
    });

    const ext = service.getExtensions().find((e) => e.id === 'sys.test');
    expect(ext).toMatchObject({ name: 'Test Extension', is_enabled: 1, source_type: 'marketplace' });
    expect(JSON.parse(ext!.provides)).toEqual(['theme']);
  });

  it('project rule CRUD works end to end, scoped by project', () => {
    service.saveProjectRule('r1', 'projA', 'Always write tests');
    service.saveProjectRule('r2', 'projB', 'Use tabs');

    expect(service.getProjectRules('projA')).toHaveLength(1);
    expect(service.getProjectRules('projA')[0]).toMatchObject({ rule_text: 'Always write tests', is_active: 1 });
    expect(service.getProjectRules('projB')).toHaveLength(1);

    service.deleteProjectRule('r1');
    expect(service.getProjectRules('projA')).toHaveLength(0);
  });

  it('editing a rule preserves its toggled-off state instead of silently re-enabling it', () => {
    service.saveProjectRule('r1', 'projA', 'Always write tests');
    service.setProjectRuleActive('r1', false);

    service.saveProjectRule('r1', 'projA', 'Always write unit tests');

    expect(service.getProjectRules('projA')[0]).toMatchObject({ rule_text: 'Always write unit tests', is_active: 0 });
  });

  it('project memory CRUD works end to end, and editing preserves created_at ordering', () => {
    service.saveProjectMemory('m1', 'projA', 'framework', 'React');
    service.saveProjectMemory('m2', 'projA', 'db', 'SQLite');
    const originalCreatedAt = service.getProjectMemories('projA')[0].created_at;

    service.saveProjectMemory('m1', 'projA', 'framework', 'React 18');

    const memories = service.getProjectMemories('projA');
    expect(memories.map((m) => m.memory_key)).toEqual(['framework', 'db']);
    expect(memories[0]).toMatchObject({ memory_val: 'React 18', created_at: originalCreatedAt });

    service.deleteProjectMemory('m1');
    expect(service.getProjectMemories('projA')).toHaveLength(1);
  });

  it('the low-level run()/queryAll() escape hatch works for a query outside the high-level API (indexer.ts use case)', () => {
    service.run('INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES (?, ?, ?, ?)', [
      'rule1',
      'proj1',
      'Always write tests',
      1,
    ]);
    const rules = service.queryAll<{ rule_text: string }>('SELECT rule_text FROM project_rules WHERE is_active = 1');
    expect(rules).toEqual([{ rule_text: 'Always write tests' }]);
  });

  it('logs and recovers when the db file on disk is corrupt', async () => {
    fs.writeFileSync(dbPath, 'not a valid sqlite file');
    const recoveryLog = new FakeLogService();
    const recovered = new DatabaseService(recoveryLog);

    await recovered.initialize(dbPath);

    expect(recoveryLog.errors.some((e) => e[0] === 'Failed to load database file, initializing empty database:')).toBe(true);
    expect(recovered.getFeatureFlags().length).toBeGreaterThan(0); // still usable — fresh DB was seeded
  });

  it('transaction() flushes to disk exactly once, not once per run() call inside it', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    writeSpy.mockClear();

    service.transaction(() => {
      for (let i = 0; i < 10; i++) {
        service.run('INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES (?, ?, ?, ?)', [
          `rule${i}`,
          'projA',
          `rule number ${i}`,
          1,
        ]);
      }
    });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(service.getProjectRules('projA')).toHaveLength(10);

    writeSpy.mockRestore();
  });

  it('transaction() rolls back and rethrows on error, without persisting a partial result', () => {
    service.run('INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES (?, ?, ?, ?)', [
      'existing',
      'projA',
      'already there before the transaction',
      1,
    ]);

    expect(() =>
      service.transaction(() => {
        service.run('INSERT INTO project_rules (id, project_id, rule_text, is_active) VALUES (?, ?, ?, ?)', [
          'partial',
          'projA',
          'should not survive',
          1,
        ]);
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const rules = service.getProjectRules('projA');
    expect(rules).toHaveLength(1);
    expect(rules[0].rule_text).toBe('already there before the transaction');
  });

  it('transaction() return value round-trips normally', () => {
    const result = service.transaction(() => {
      service.setSetting('theme', 'dracula');
      return 42;
    });

    expect(result).toBe(42);
    expect(service.getSettings()).toMatchObject({ theme: 'dracula' });
  });

  describe('Workspace Trust', () => {
    it('getProjectTrustState() returns null for a folder never opened before', () => {
      expect(service.getProjectTrustState('/some/never-opened/path')).toBeNull();
    });

    it('setProjectTrustState() persists trust for a path with no existing project row', () => {
      service.setProjectTrustState('/some/fresh/path', 'trusted');
      expect(service.getProjectTrustState('/some/fresh/path')).toBe('trusted');
    });

    it('setProjectTrustState() updates trust for a path that already has a project row', () => {
      service.addProject('proj_1', 'demo', '/some/known/path');
      expect(service.getProjectTrustState('/some/known/path')).toBeNull();

      service.setProjectTrustState('/some/known/path', 'restricted');
      expect(service.getProjectTrustState('/some/known/path')).toBe('restricted');

      service.setProjectTrustState('/some/known/path', 'trusted');
      expect(service.getProjectTrustState('/some/known/path')).toBe('trusted');
    });

    it('addProject() re-opening an already-trusted folder does not reset its trust state', () => {
      service.addProject('proj_1', 'demo', '/some/known/path');
      service.setProjectTrustState('/some/known/path', 'trusted');

      // Simulates reopening the same folder via File > Open Folder later —
      // addProject used to be INSERT OR REPLACE, which wiped trust_state
      // back to NULL on every reopen.
      service.addProject('proj_1', 'demo', '/some/known/path');

      expect(service.getProjectTrustState('/some/known/path')).toBe('trusted');
    });

    it('addProject() still updates name/last_opened on reopen', () => {
      service.addProject('proj_1', 'old-name', '/some/known/path');
      service.addProject('proj_1', 'renamed-folder', '/some/known/path');

      const projects = service.getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('renamed-folder');
    });
  });

  describe('Local History', () => {
    it('getFileHistory() returns an empty array for a file with no snapshots yet', () => {
      expect(service.getFileHistory('/ws', '/ws/a.ts')).toEqual([]);
    });

    it('saveFileSnapshot() records a snapshot retrievable by id, most recent first', () => {
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v1');
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v2');

      const history = service.getFileHistory('/ws', '/ws/a.ts');
      expect(history).toHaveLength(2);
      expect(service.getFileSnapshotContent(history[0].id)).toBe('v2');
      expect(service.getFileSnapshotContent(history[1].id)).toBe('v1');
    });

    it('saveFileSnapshot() is a no-op when content matches the most recent snapshot', () => {
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v1');
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v1');

      expect(service.getFileHistory('/ws', '/ws/a.ts')).toHaveLength(1);
    });

    it('saveFileSnapshot() records a new snapshot again after content changes back and forth', () => {
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v1');
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v2');
      service.saveFileSnapshot('/ws', '/ws/a.ts', 'v1');

      expect(service.getFileHistory('/ws', '/ws/a.ts')).toHaveLength(3);
    });

    it('scopes history independently per (workspace, file path) — same relative path in two workspaces does not collide', () => {
      service.saveFileSnapshot('/ws-a', '/ws-a/shared.ts', 'from workspace a');
      service.saveFileSnapshot('/ws-b', '/ws-b/shared.ts', 'from workspace b');

      expect(service.getFileHistory('/ws-a', '/ws-a/shared.ts')).toHaveLength(1);
      expect(service.getFileHistory('/ws-b', '/ws-b/shared.ts')).toHaveLength(1);
    });

    it('getFileSnapshotContent() returns null for an unknown id', () => {
      expect(service.getFileSnapshotContent('snap_does_not_exist')).toBeNull();
    });

    it('prunes to the most recent 50 snapshots per file', () => {
      for (let i = 0; i < 55; i++) {
        service.saveFileSnapshot('/ws', '/ws/a.ts', `v${i}`);
      }

      const history = service.getFileHistory('/ws', '/ws/a.ts');
      expect(history).toHaveLength(50);
      // Most recent (v54) survives; the oldest 5 (v0-v4) were pruned.
      expect(service.getFileSnapshotContent(history[0].id)).toBe('v54');
      const contents = history.map((h) => service.getFileSnapshotContent(h.id));
      expect(contents).not.toContain('v0');
      expect(contents).not.toContain('v4');
    });
  });
});
