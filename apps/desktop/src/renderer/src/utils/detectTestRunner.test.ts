import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectTestRunnerCommand } from './detectTestRunner';

const setApi = (readFile: (path: string) => Promise<string>) => {
  (globalThis as any).window = { api: { readFile: vi.fn(readFile) } };
};

describe('detectTestRunnerCommand', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('substitutes the target file path for a vitest-based test script', async () => {
    setApi(async () => JSON.stringify({ scripts: { test: 'vitest run' } }));
    const result = await detectTestRunnerCommand('/ws', ['src/util.test.ts']);
    expect(result).toEqual({ command: 'npx vitest run "src/util.test.ts"', scopedToFile: true });
  });

  it('substitutes the target file path for a jest-based test script', async () => {
    setApi(async () => JSON.stringify({ scripts: { test: 'jest --ci' } }));
    const result = await detectTestRunnerCommand('/ws', ['src/util.test.ts']);
    expect(result).toEqual({ command: 'npx jest "src/util.test.ts"', scopedToFile: true });
  });

  it('falls back to running the unmodified script, flagged as not scoped, for an unrecognized runner', async () => {
    setApi(async () => JSON.stringify({ scripts: { test: 'mocha test/**/*.js' } }));
    const result = await detectTestRunnerCommand('/ws', ['src/util.test.ts']);
    expect(result).toEqual({ command: 'mocha test/**/*.js', scopedToFile: false });
  });

  it('returns null when there is no test script at all', async () => {
    setApi(async () => JSON.stringify({ scripts: { build: 'tsc' } }));
    const result = await detectTestRunnerCommand('/ws', ['src/util.test.ts']);
    expect(result).toBeNull();
  });

  it('returns null when package.json cannot be read', async () => {
    setApi(async () => {
      throw new Error('ENOENT');
    });
    const result = await detectTestRunnerCommand('/ws', ['src/util.test.ts']);
    expect(result).toBeNull();
  });

  it('returns null when there are no suggested test files', async () => {
    setApi(async () => JSON.stringify({ scripts: { test: 'vitest run' } }));
    const result = await detectTestRunnerCommand('/ws', []);
    expect(result).toBeNull();
  });
});
