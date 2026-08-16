import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DebugAdapterRegistry } from './debugAdapterRegistry';
import { ExtensionHostService } from '../runtime';
import { DatabaseService } from '../../platform/db';
import { FakeLogService } from '../../platform/log';

function writeStaticExtension(extensionsRoot: string, id: string, contributes: Record<string, unknown>) {
  const dir = path.join(extensionsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', publisher: 'test', contributes }),
  );
}

describe('DebugAdapterRegistry (real extension-host + real sqlite DB, no mocking)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;
  let databaseService: DatabaseService;
  let log: FakeLogService;
  let registry: DebugAdapterRegistry;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-debugadapter-registry-test-'));
    log = new FakeLogService();
    extensionHostService = new ExtensionHostService(new FakeLogService());
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    registry = new DebugAdapterRegistry(extensionHostService, databaseService, log);
  });

  afterEach(() => {
    extensionHostService.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a declared debug adapter contribution appears with no activation required', async () => {
    writeStaticExtension(tmpDir, 'ext.go', {
      debugAdapters: [{ languageId: 'go', binary: 'dlv', args: ['dap'] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([
      { extensionId: 'ext.go', languageId: 'go', binary: 'dlv', args: ['dap'] },
    ]);
    expect(registry.listDebugAdapters()).toEqual(registry.list());
  });

  it('defaults missing args to an empty array', async () => {
    writeStaticExtension(tmpDir, 'ext.rust', {
      debugAdapters: [{ languageId: 'rust', binary: 'lldb-vscode' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([
      { extensionId: 'ext.rust', languageId: 'rust', binary: 'lldb-vscode', args: [] },
    ]);
  });

  it('excludes contributions from an extension explicitly disabled in the DB', async () => {
    writeStaticExtension(tmpDir, 'ext.disabled', {
      debugAdapters: [{ languageId: 'go', binary: 'dlv' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);
    databaseService.saveExtension({ id: 'ext.disabled', name: 'ext.disabled', version: '1.0.0', isEnabled: false });

    expect(registry.list()).toEqual([]);
  });

  it('rejects an entry missing languageId, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad', {
      debugAdapters: [{ languageId: '', binary: 'dlv' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('rejects an entry missing binary, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad2', {
      debugAdapters: [{ languageId: 'go', binary: '' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('multiple extensions contributing different languages all appear', async () => {
    writeStaticExtension(tmpDir, 'ext.go', { debugAdapters: [{ languageId: 'go', binary: 'dlv' }] });
    writeStaticExtension(tmpDir, 'ext.rust', { debugAdapters: [{ languageId: 'rust', binary: 'lldb-vscode' }] });
    await extensionHostService.discoverExtensions(tmpDir);

    const languageIds = registry.list().map((r) => r.languageId).sort();
    expect(languageIds).toEqual(['go', 'rust']);
  });
});
