import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { crawlDirectory } from './indexer';

describe('crawlDirectory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-indexer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const write = (relPath: string, content = 'export const x = 1;') => {
    const fullPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };

  it('returns real source files and skips node_modules, .git, dist, and dist-electron', () => {
    // Real, indexable files
    write('src/a.ts');
    write('src/nested/b.tsx');

    // node_modules — a real pnpm-shaped tree, should never be walked
    write('node_modules/some-package/index.js');
    write('node_modules/.pnpm/pkg@1.0.0/node_modules/pkg/index.js');

    // .git internals
    write('.git/HEAD', 'ref: refs/heads/main');
    write('.git/objects/aa/bb', 'binary-ish content');

    // Regression case: a build-output directory whose name doesn't exactly
    // match any single entry in a naive denylist (this is the real bug
    // found in production — apps/desktop/dist-electron/ on disk, ~54MB of
    // minified bundles, escaped an IGNORE_DIRS that only had 'dist').
    write('dist-electron/main/index-abc123.js', 'minified bundle content'.repeat(1000));

    // Already-correctly-excluded sibling, as a sanity check the fix didn't
    // remove or break the pre-existing 'dist' entry.
    write('dist/bundle.js');

    const files: string[] = [];
    crawlDirectory(tmpDir, files);

    const relFiles = files.map((f) => path.relative(tmpDir, f).replace(/\\/g, '/')).sort();
    expect(relFiles).toEqual(['src/a.ts', 'src/nested/b.tsx']);
  });

  it('only collects files with parsable extensions, ignoring everything else', () => {
    write('src/a.ts');
    write('README.md');
    write('package.json', '{}');
    write('image.png', 'not real image data');

    const files: string[] = [];
    crawlDirectory(tmpDir, files);

    const relFiles = files.map((f) => path.relative(tmpDir, f).replace(/\\/g, '/'));
    expect(relFiles).toEqual(['src/a.ts']);
  });

  it('returns an empty list (not an error) for a directory that does not exist', () => {
    const files: string[] = [];
    crawlDirectory(path.join(tmpDir, 'does-not-exist'), files);
    expect(files).toEqual([]);
  });
});
