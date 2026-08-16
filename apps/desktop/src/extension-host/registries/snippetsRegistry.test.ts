import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SnippetsRegistry } from './snippetsRegistry';
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

describe('SnippetsRegistry (real extension-host + real sqlite DB, no mocking)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;
  let databaseService: DatabaseService;
  let log: FakeLogService;
  let registry: SnippetsRegistry;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-snippets-registry-test-'));
    log = new FakeLogService();
    extensionHostService = new ExtensionHostService(new FakeLogService());
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    registry = new SnippetsRegistry(extensionHostService, databaseService, log);
  });

  afterEach(() => {
    extensionHostService.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('an extension with no DB row at all still appears (matches how manually-dropped-in extensions behave today)', async () => {
    writeStaticExtension(tmpDir, 'ext.snippets', {
      snippets: [{ language: 'javascript', path: 'snippets/javascript.json' }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    const result = registry.list();

    expect(result).toEqual([
      { extensionId: 'ext.snippets', language: 'javascript', absolutePath: path.join(tmpDir, 'ext.snippets', 'snippets', 'javascript.json') },
    ]);
  });

  it('excludes contributions from an extension explicitly disabled in the DB', async () => {
    writeStaticExtension(tmpDir, 'ext.disabled', { snippets: [{ language: 'javascript', path: 'a.json' }] });
    await extensionHostService.discoverExtensions(tmpDir);
    databaseService.saveExtension({ id: 'ext.disabled', name: 'ext.disabled', version: '1.0.0', isEnabled: false });

    expect(registry.list()).toEqual([]);
  });

  it('rejects a path that escapes the extension\'s own directory, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.evil', { snippets: [{ language: 'javascript', path: '../../outside.json' }] });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.some((e) => String(e[0]).includes('outside its own directory'))).toBe(true);
  });

  it('rejects an entry with an empty language, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.badlang', { snippets: [{ language: '', path: 'a.json' }] });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('listForLanguage filters correctly across multiple extensions and languages', async () => {
    writeStaticExtension(tmpDir, 'ext.js', { snippets: [{ language: 'javascript', path: 'js.json' }] });
    writeStaticExtension(tmpDir, 'ext.py', { snippets: [{ language: 'python', path: 'py.json' }] });
    await extensionHostService.discoverExtensions(tmpDir);

    const jsOnly = registry.listForLanguage('javascript');

    expect(jsOnly).toHaveLength(1);
    expect(jsOnly[0].extensionId).toBe('ext.js');
  });
});
