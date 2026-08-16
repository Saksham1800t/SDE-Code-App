import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExtensionHostService } from './extensionHostService';
import { FakeLogService } from '../../platform/log';

function writeExtension(
  extensionsRoot: string,
  id: string,
  opts: { activationEvents?: string[]; entrySource: string; main?: string },
) {
  const dir = path.join(extensionsRoot, id);
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      publisher: 'test',
      main: opts.main ?? 'dist/index.js',
      activationEvents: opts.activationEvents ?? ['onStartupFinished'],
    }),
  );
  fs.writeFileSync(path.join(dir, opts.main ?? 'dist/index.js'), opts.entrySource);
}

/** A manifest-only extension with no `main`/`activationEvents`/entry file at all — proves declarative contributions never need activation. */
function writeStaticExtension(extensionsRoot: string, id: string, contributes: Record<string, unknown>) {
  const dir = path.join(extensionsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', publisher: 'test', contributes }),
  );
}

describe('ExtensionHostService (real files on disk, real vm sandbox)', () => {
  let tmpDir: string;
  let log: FakeLogService;
  let service: ExtensionHostService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-exthost-test-'));
    log = new FakeLogService();
    service = new ExtensionHostService(log);
  });

  afterEach(() => {
    service.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers every subfolder containing a manifest.json and reports the count', async () => {
    writeExtension(tmpDir, 'ext.one', { entrySource: `module.exports = {};` });
    writeExtension(tmpDir, 'ext.two', { entrySource: `module.exports = {};` });
    fs.mkdirSync(path.join(tmpDir, 'not-an-extension')); // no manifest.json — should be skipped

    const count = await service.discoverExtensions(tmpDir);

    expect(count).toBe(2);
    expect(service.getLoadedExtensions().map((e) => e.manifest.id).sort()).toEqual(['ext.one', 'ext.two']);
  });

  it('does not activate anything until a matching activation event fires', async () => {
    writeExtension(tmpDir, 'ext.lazy', {
      activationEvents: ['onCommand:ext.lazy.doThing'],
      entrySource: `
        const { registerCommand } = require('@sde-code/sdk');
        module.exports = { activate: () => registerCommand('ext.lazy.doThing', () => 'done') };
      `,
    });
    await service.discoverExtensions(tmpDir);

    await service.fireActivationEvent('onStartupFinished'); // does NOT match this extension's declared event

    expect(service.getLoadedExtensions()[0].activated).toBe(false);
    expect(service.getRegistrations('command')).toEqual([]);
  });

  it('activates an extension once its declared activation event fires, and its registration appears', async () => {
    writeExtension(tmpDir, 'ext.eager', {
      activationEvents: ['onStartupFinished'],
      entrySource: `
        const { registerCommand } = require('@sde-code/sdk');
        module.exports = { activate: () => registerCommand('ext.eager.hello', () => 'hello!') };
      `,
    });
    await service.discoverExtensions(tmpDir);

    await service.fireActivationEvent('onStartupFinished');

    expect(service.getLoadedExtensions()[0].activated).toBe(true);
    const registrations = service.getRegistrations('command');
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ extensionId: 'ext.eager', kind: 'command' });
  });

  it('a real registered command can be invoked through the service and returns the extension\'s real result', async () => {
    writeExtension(tmpDir, 'ext.math', {
      entrySource: `
        const { registerCommand } = require('@sde-code/sdk');
        module.exports = { activate: () => registerCommand('ext.math.double', (n) => n * 2) };
      `,
    });
    await service.discoverExtensions(tmpDir);
    await service.fireActivationEvent('onStartupFinished');

    const { callbackId } = service.getRegistrations('command')[0].payload as { callbackId: string };
    await expect(service.invoke('ext.math', callbackId, [21])).resolves.toBe(42);
  });

  it('"*" activation event runs regardless of which event actually fires', async () => {
    writeExtension(tmpDir, 'ext.always', {
      activationEvents: ['*'],
      entrySource: `module.exports = { activate: () => {} };`,
    });
    await service.discoverExtensions(tmpDir);

    await service.fireActivationEvent('some-completely-unrelated-event');

    expect(service.getLoadedExtensions()[0].activated).toBe(true);
  });

  it('an extension that throws during activation is logged, not left half-activated forever, and does not crash discovery of others', async () => {
    writeExtension(tmpDir, 'ext.broken', {
      entrySource: `module.exports = { activate: () => { throw new Error('boom'); } };`,
    });
    writeExtension(tmpDir, 'ext.fine', {
      entrySource: `module.exports = { activate: () => {} };`,
    });
    await service.discoverExtensions(tmpDir);

    await service.fireActivationEvent('onStartupFinished');

    expect(log.errors.some((e) => String(e[0]).includes('ext.broken'))).toBe(true);
    const fine = service.getLoadedExtensions().find((e) => e.manifest.id === 'ext.fine');
    expect(fine?.activated).toBe(true);
  });

  it('invoking a command belonging to an unknown extension rejects clearly', async () => {
    await expect(service.invoke('does-not-exist', 'cb1', [])).rejects.toThrow(/Unknown extension/);
  });

  it('a malformed manifest.json is logged and skipped rather than crashing discovery', async () => {
    const dir = path.join(tmpDir, 'ext.malformed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not valid json');

    const count = await service.discoverExtensions(tmpDir);

    expect(count).toBe(0);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  describe('getStaticContributions', () => {
    it('reads a declarative contribution straight off the manifest, with no activation at all', async () => {
      writeStaticExtension(tmpDir, 'ext.snippets', {
        snippets: [{ language: 'javascript', path: 'snippets/javascript.json' }],
      });
      await service.discoverExtensions(tmpDir);

      const contributions = service.getStaticContributions<Array<{ language: string; path: string }>>('snippets');

      expect(contributions).toHaveLength(1);
      expect(contributions[0].extensionId).toBe('ext.snippets');
      expect(contributions[0].rootDir).toBe(path.join(tmpDir, 'ext.snippets'));
      expect(contributions[0].value).toEqual([{ language: 'javascript', path: 'snippets/javascript.json' }]);
      expect(service.getLoadedExtensions()[0].activated).toBe(false);
    });

    it('returns an empty array for a kind nothing contributes', async () => {
      writeStaticExtension(tmpDir, 'ext.snippets', { snippets: [{ language: 'javascript', path: 'a.json' }] });
      await service.discoverExtensions(tmpDir);

      expect(service.getStaticContributions('grammars')).toEqual([]);
    });

    it('a manifest with no contributes field at all contributes nothing, without throwing', async () => {
      writeExtension(tmpDir, 'ext.plain', { entrySource: `module.exports = {};` });
      await service.discoverExtensions(tmpDir);

      expect(service.getStaticContributions('snippets')).toEqual([]);
    });
  });
});
