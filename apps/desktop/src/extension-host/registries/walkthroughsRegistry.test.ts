import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WalkthroughsRegistry } from './walkthroughsRegistry';
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

describe('WalkthroughsRegistry (real extension-host + real sqlite DB, no mocking)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;
  let databaseService: DatabaseService;
  let log: FakeLogService;
  let registry: WalkthroughsRegistry;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-walkthroughs-registry-test-'));
    log = new FakeLogService();
    extensionHostService = new ExtensionHostService(new FakeLogService());
    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    registry = new WalkthroughsRegistry(extensionHostService, databaseService, log);
  });

  afterEach(() => {
    extensionHostService.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('an extension with no DB row at all still appears, with its id namespaced by extensionId', async () => {
    writeStaticExtension(tmpDir, 'ext.tour', {
      walkthroughs: [{
        id: 'tour',
        title: 'Tour',
        steps: [{ id: 'step1', title: 'Step 1', description: 'Do a thing.' }],
      }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    const result = registry.list();

    expect(result).toEqual([
      {
        extensionId: 'ext.tour',
        id: 'ext.tour:tour',
        title: 'Tour',
        description: undefined,
        steps: [{ id: 'step1', title: 'Step 1', description: 'Do a thing.' }],
      },
    ]);
  });

  it('excludes contributions from an extension explicitly disabled in the DB', async () => {
    writeStaticExtension(tmpDir, 'ext.disabled', {
      walkthroughs: [{ id: 'tour', title: 'Tour', steps: [{ id: 's1', title: 'S1', description: 'd' }] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);
    databaseService.saveExtension({ id: 'ext.disabled', name: 'ext.disabled', version: '1.0.0', isEnabled: false });

    expect(registry.list()).toEqual([]);
  });

  it('rejects a contribution missing a title, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.notitle', {
      walkthroughs: [{ id: 'tour', title: '', steps: [{ id: 's1', title: 'S1', description: 'd' }] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('rejects a contribution with an empty steps array, logs it, and does not throw', async () => {
    writeStaticExtension(tmpDir, 'ext.nosteps', { walkthroughs: [{ id: 'tour', title: 'Tour', steps: [] }] });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('rejects the whole walkthrough when any one step is missing an id or title', async () => {
    writeStaticExtension(tmpDir, 'ext.badstep', {
      walkthroughs: [{
        id: 'tour',
        title: 'Tour',
        steps: [{ id: 's1', title: 'S1', description: 'd' }, { id: '', title: 'Bad', description: 'd' }],
      }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    expect(registry.list()).toEqual([]);
    expect(log.errors.some((e) => String(e[0]).includes('invalid step'))).toBe(true);
  });

  it('lists multiple walkthroughs from multiple extensions', async () => {
    writeStaticExtension(tmpDir, 'ext.a', {
      walkthroughs: [{ id: 'tour', title: 'A Tour', steps: [{ id: 's1', title: 'S1', description: 'd' }] }],
    });
    writeStaticExtension(tmpDir, 'ext.b', {
      walkthroughs: [{ id: 'tour', title: 'B Tour', steps: [{ id: 's1', title: 'S1', description: 'd' }] }],
    });
    await extensionHostService.discoverExtensions(tmpDir);

    const ids = registry.list().map((w) => w.id).sort();

    expect(ids).toEqual(['ext.a:tour', 'ext.b:tour']);
  });
});
