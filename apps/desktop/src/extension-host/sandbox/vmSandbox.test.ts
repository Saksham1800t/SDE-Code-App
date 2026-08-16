import { describe, expect, it, vi } from 'vitest';
import { loadExtensionInSandbox } from './vmSandbox';

describe('loadExtensionInSandbox', () => {
  it('runs CommonJS-style source and returns its module.exports', () => {
    const source = `module.exports = { hello: () => 'world' };`;
    const exports = loadExtensionInSandbox(source, '/fake/index.js', () => {
      throw new Error('should not be called');
    }) as { hello(): string };

    expect(exports.hello()).toBe('world');
  });

  it('passes require() through to the provided requireFn', () => {
    const requireFn = vi.fn((specifier: string) => (specifier === 'fake-module' ? { value: 42 } : undefined));
    const source = `const mod = require('fake-module'); module.exports = { value: mod.value };`;

    const exports = loadExtensionInSandbox(source, '/fake/index.js', requireFn) as { value: number };

    expect(requireFn).toHaveBeenCalledWith('fake-module');
    expect(exports.value).toBe(42);
  });

  it('propagates a requireFn rejection (disallowed module) as a real thrown error', () => {
    const requireFn = () => {
      throw new Error('Module "fs" is not available inside an SDE Code extension sandbox.');
    };
    const source = `require('fs');`;

    expect(() => loadExtensionInSandbox(source, '/fake/index.js', requireFn)).toThrow(/not available/);
  });

  it('runs in a separate global scope — setting a global inside does not leak to the host process', () => {
    const source = `globalThis.leakedFromExtension = 'oops';`;
    loadExtensionInSandbox(source, '/fake/index.js', () => undefined);

    expect((globalThis as Record<string, unknown>).leakedFromExtension).toBeUndefined();
  });

  it('supports exporting an activate() lifecycle function that captures closure state', async () => {
    const source = `
      let activated = false;
      module.exports = {
        activate: () => { activated = true; },
        wasActivated: () => activated,
      };
    `;
    const exports = loadExtensionInSandbox(source, '/fake/index.js', () => undefined) as {
      activate(): void;
      wasActivated(): boolean;
    };

    expect(exports.wasActivated()).toBe(false);
    await exports.activate();
    expect(exports.wasActivated()).toBe(true);
  });

  it('__filename and __dirname are set correctly from the given filename', () => {
    const source = `module.exports = { filename: __filename, dirname: __dirname };`;
    const exports = loadExtensionInSandbox(source, '/fake/extensions/foo/dist/index.js', () => undefined) as {
      filename: string;
      dirname: string;
    };

    expect(exports.filename).toBe('/fake/extensions/foo/dist/index.js');
    expect(exports.dirname).toBe('/fake/extensions/foo/dist');
  });
});
