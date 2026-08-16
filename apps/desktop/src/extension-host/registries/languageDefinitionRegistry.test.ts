import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LanguageDefinitionRegistry } from './languageDefinitionRegistry';
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

describe('LanguageDefinitionRegistry (real extension-host + real sqlite DB, no mocking)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;
  let databaseService: DatabaseService;
  let log: FakeLogService;
  let registry: LanguageDefinitionRegistry;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-langdef-registry-test-'));
    log = new FakeLogService();
    extensionHostService = new ExtensionHostService(new FakeLogService());
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    registry = new LanguageDefinitionRegistry(extensionHostService, databaseService, log);
  });

  afterEach(() => {
    extensionHostService.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a declared language contribution appears with no activation required', async () => {
    writeStaticExtension(tmpDir, 'ext.toy', {
      languages: [{ languageId: 'toy', extensions: ['.toy'], aliases: ['Toy'], monarch: { keywords: ['let'] } }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([
      { extensionId: 'ext.toy', languageId: 'toy', extensions: ['.toy'], aliases: ['Toy'], monarch: { keywords: ['let'] }, configuration: undefined },
    ]);
  });

  it('excludes contributions from an extension explicitly disabled in the DB', async () => {
    writeStaticExtension(tmpDir, 'ext.disabled', {
      languages: [{ languageId: 'toy', extensions: ['.toy'] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);
    databaseService.saveExtension({ id: 'ext.disabled', name: 'ext.disabled', version: '1.0.0', isEnabled: false });

    expect(registry.list()).toEqual([]);
  });

  it('rejects an entry missing languageId, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad', {
      languages: [{ languageId: '', extensions: ['.toy'] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('rejects an entry with no extensions, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.bad2', {
      languages: [{ languageId: 'toy', extensions: [] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('monarch and configuration are both optional', async () => {
    writeStaticExtension(tmpDir, 'ext.bare', {
      languages: [{ languageId: 'toy', extensions: ['.toy'] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([
      { extensionId: 'ext.bare', languageId: 'toy', extensions: ['.toy'], aliases: undefined, monarch: undefined, configuration: undefined },
    ]);
  });
});
