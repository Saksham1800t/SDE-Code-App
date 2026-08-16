import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LanguageServerRegistry } from './languageServerRegistry';
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

describe('LanguageServerRegistry (real extension-host + real sqlite DB, no mocking)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;
  let databaseService: DatabaseService;
  let log: FakeLogService;
  let registry: LanguageServerRegistry;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-langserver-registry-test-'));
    log = new FakeLogService();
    extensionHostService = new ExtensionHostService(new FakeLogService());
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    registry = new LanguageServerRegistry(extensionHostService, databaseService, log);
  });

  afterEach(() => {
    extensionHostService.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a declared language server contribution appears with no activation required', async () => {
    writeStaticExtension(tmpDir, 'ext.go', {
      languageServers: [{ languageId: 'go', extensions: ['.go'], binary: 'gopls', args: ['serve'] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([
      { extensionId: 'ext.go', languageId: 'go', binary: 'gopls', args: ['serve'], extensions: ['.go'] },
    ]);
    expect(registry.listLanguageServers()).toEqual(registry.list());
  });

  it('defaults missing args to an empty array', async () => {
    writeStaticExtension(tmpDir, 'ext.rust', {
      languageServers: [{ languageId: 'rust', extensions: ['.rs'], binary: 'rust-analyzer' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([
      { extensionId: 'ext.rust', languageId: 'rust', binary: 'rust-analyzer', args: [], extensions: ['.rs'] },
    ]);
  });

  it('excludes contributions from an extension explicitly disabled in the DB', async () => {
    writeStaticExtension(tmpDir, 'ext.disabled', {
      languageServers: [{ languageId: 'go', extensions: ['.go'], binary: 'gopls' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);
    databaseService.saveExtension({ id: 'ext.disabled', name: 'ext.disabled', version: '1.0.0', isEnabled: false });

    expect(registry.list()).toEqual([]);
  });

  it('rejects an entry missing languageId, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad', {
      languageServers: [{ languageId: '', extensions: ['.go'], binary: 'gopls' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('rejects an entry with no extensions, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad2', {
      languageServers: [{ languageId: 'go', extensions: [], binary: 'gopls' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('rejects an entry missing binary, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad3', {
      languageServers: [{ languageId: 'go', extensions: ['.go'], binary: '' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('multiple extensions contributing different languages all appear', async () => {
    writeStaticExtension(tmpDir, 'ext.go', { languageServers: [{ languageId: 'go', extensions: ['.go'], binary: 'gopls' }] });
    writeStaticExtension(tmpDir, 'ext.rust', { languageServers: [{ languageId: 'rust', extensions: ['.rs'], binary: 'rust-analyzer' }] });
    await extensionHostService.discoverExtensions(tmpDir);

    const languageIds = registry.list().map((r) => r.languageId).sort();
    expect(languageIds).toEqual(['go', 'rust']);
  });
});
