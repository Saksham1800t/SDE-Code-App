import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExtensionHostService } from '../runtime';
import { CommandRegistry } from './commandRegistry';
import { StatusBarRegistry } from './statusBarRegistry';
import { ThemeRegistry } from './themeRegistry';
import { FakeLogService } from '../../platform/log';

function writeExtension(extensionsRoot: string, id: string, entrySource: string) {
  const dir = path.join(extensionsRoot, id);
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', publisher: 'test', main: 'dist/index.js', activationEvents: ['*'] }),
  );
  fs.writeFileSync(path.join(dir, 'dist/index.js'), entrySource);
}

describe('CommandRegistry / StatusBarRegistry / ThemeRegistry (real extension, real sandbox)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-registries-test-'));
    extensionHostService = new ExtensionHostService(new FakeLogService());

    writeExtension(
      tmpDir,
      'ext.demo',
      `
      const { registerCommand, registerStatusBarItem, registerTheme } = require('@sde-code/sdk');
      module.exports = {
        activate: () => {
          registerCommand('ext.demo.double', (n) => n * 2);
          registerStatusBarItem('ext.demo.status', { text: 'Demo Active', alignment: 'right' });
          registerTheme('ext.demo.dark', { bgPrimary: '#000', bgSecondary: '#111', textPrimary: '#fff', accentCyan: '#0ff' });
        },
      };
      `,
    );
    await extensionHostService.discoverExtensions(tmpDir);
    await extensionHostService.fireActivationEvent('onStartupFinished');
  });

  afterEach(() => {
    extensionHostService.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('CommandRegistry.list() reports the registered command', () => {
    const registry = new CommandRegistry(extensionHostService);
    expect(registry.list()).toEqual([{ id: 'ext.demo.double', extensionId: 'ext.demo' }]);
  });

  it('CommandRegistry.execute() runs the real extension callback and returns its result', async () => {
    const registry = new CommandRegistry(extensionHostService);
    await expect(registry.execute('ext.demo.double', [21])).resolves.toBe(42);
  });

  it('CommandRegistry.execute() rejects clearly for an unregistered command', async () => {
    const registry = new CommandRegistry(extensionHostService);
    await expect(registry.execute('does.not.exist', [])).rejects.toThrow(/Unknown extension command/);
  });

  it('StatusBarRegistry.list() reports the registered item with its full options', () => {
    const registry = new StatusBarRegistry(extensionHostService);
    expect(registry.list()).toEqual([
      { id: 'ext.demo.status', extensionId: 'ext.demo', options: { text: 'Demo Active', alignment: 'right' } },
    ]);
  });

  it('ThemeRegistry.list() reports the registered theme with its full variables', () => {
    const registry = new ThemeRegistry(extensionHostService);
    expect(registry.list()).toEqual([
      {
        id: 'ext.demo.dark',
        extensionId: 'ext.demo',
        variables: { bgPrimary: '#000', bgSecondary: '#111', textPrimary: '#fff', accentCyan: '#0ff' },
      },
    ]);
  });

  it('registries reflect nothing before activation happens', async () => {
    const freshService = new ExtensionHostService(new FakeLogService());
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-registries-fresh-'));
    writeExtension(
      freshDir,
      'ext.lazy',
      `
      const { registerCommand } = require('@sde-code/sdk');
      module.exports = { activate: () => registerCommand('ext.lazy.cmd', () => 'x') };
      `,
    );
    // Overwrite this one extension's activationEvents to something that never fires in this test.
    fs.writeFileSync(
      path.join(freshDir, 'ext.lazy/manifest.json'),
      JSON.stringify({ id: 'ext.lazy', name: 'ext.lazy', version: '1.0.0', publisher: 'test', main: 'dist/index.js', activationEvents: ['onCommand:never'] }),
    );
    await freshService.discoverExtensions(freshDir);
    await freshService.fireActivationEvent('onStartupFinished');

    expect(new CommandRegistry(freshService).list()).toEqual([]);

    freshService.dispose();
    fs.rmSync(freshDir, { recursive: true, force: true });
  });
});
