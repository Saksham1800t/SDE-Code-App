import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExtensionHostService } from '../runtime';
import { AIToolRegistry } from './aiToolRegistry';
import { AIContextProviderRegistry } from './aiContextProviderRegistry';
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

describe('AIToolRegistry / AIContextProviderRegistry (real extension, real sandbox)', () => {
  let tmpDir: string;
  let extensionHostService: ExtensionHostService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ai-registries-test-'));
    extensionHostService = new ExtensionHostService(new FakeLogService());

    writeExtension(
      tmpDir,
      'ext.demo',
      `
      const { registerAITool, registerContextProvider } = require('@sde-code/sdk');
      module.exports = {
        activate: () => {
          registerAITool({
            name: 'demo_shout',
            description: 'Uppercases the given text',
            parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            execute: async (args) => String(args.text).toUpperCase(),
          });
          registerContextProvider({
            id: 'ext.demo.context',
            provideContext: async (request) => \`active file is \${request.activeFilePath || 'none'}\`,
          });
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

  it('AIToolRegistry.listTools() reports the registered tool with its real schema', () => {
    const registry = new AIToolRegistry(extensionHostService);
    const tools = registry.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('demo_shout');
    expect(tools[0].description).toBe('Uppercases the given text');
    expect(tools[0].parameters).toEqual({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] });
  });

  it('AIToolRegistry-returned tool.execute() runs the real extension callback', async () => {
    const registry = new AIToolRegistry(extensionHostService);
    const [tool] = registry.listTools();
    await expect(tool.execute({ text: 'hello' })).resolves.toBe('HELLO');
  });

  it('AIContextProviderRegistry.collectContext() runs the real extension callback', async () => {
    const registry = new AIContextProviderRegistry(extensionHostService);
    const result = await registry.collectContext({ activeFilePath: '/workspace/foo.ts', prompt: 'explain this' });
    expect(result).toEqual(['active file is /workspace/foo.ts']);
  });

  it('AIContextProviderRegistry.collectContext() tolerates one provider throwing without dropping the others', async () => {
    const throwingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ai-registries-throwing-'));
    const throwingService = new ExtensionHostService(new FakeLogService());
    writeExtension(
      throwingDir,
      'ext.broken',
      `
      const { registerContextProvider } = require('@sde-code/sdk');
      module.exports = { activate: () => registerContextProvider({ id: 'ext.broken.context', provideContext: async () => { throw new Error('boom'); } }) };
      `,
    );
    writeExtension(
      throwingDir,
      'ext.fine',
      `
      const { registerContextProvider } = require('@sde-code/sdk');
      module.exports = { activate: () => registerContextProvider({ id: 'ext.fine.context', provideContext: async () => 'still here' }) };
      `,
    );
    await throwingService.discoverExtensions(throwingDir);
    await throwingService.fireActivationEvent('onStartupFinished');

    const registry = new AIContextProviderRegistry(throwingService);
    const result = await registry.collectContext({ prompt: 'anything' });
    expect(result).toEqual(['still here']);

    throwingService.dispose();
    fs.rmSync(throwingDir, { recursive: true, force: true });
  });

  it('registries reflect nothing before activation happens', async () => {
    const freshService = new ExtensionHostService(new FakeLogService());
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ai-registries-fresh-'));
    writeExtension(
      freshDir,
      'ext.lazy',
      `
      const { registerAITool } = require('@sde-code/sdk');
      module.exports = { activate: () => registerAITool({ name: 'x', description: 'x', parameters: {}, execute: async () => 'x' }) };
      `,
    );
    fs.writeFileSync(
      path.join(freshDir, 'ext.lazy/manifest.json'),
      JSON.stringify({ id: 'ext.lazy', name: 'ext.lazy', version: '1.0.0', publisher: 'test', main: 'dist/index.js', activationEvents: ['onCommand:never'] }),
    );
    await freshService.discoverExtensions(freshDir);
    await freshService.fireActivationEvent('onStartupFinished');

    expect(new AIToolRegistry(freshService).listTools()).toEqual([]);

    freshService.dispose();
    fs.rmSync(freshDir, { recursive: true, force: true });
  });
});
