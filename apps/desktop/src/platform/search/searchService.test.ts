import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SearchService } from './searchService';
import { FakeLogService } from '../log';

describe('SearchService', () => {
  let tmpDir: string;
  let log: FakeLogService;
  let service: SearchService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-search-test-'));
    log = new FakeLogService();
    service = new SearchService(log);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searchInFiles finds matches across nested directories with line numbers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'const foo = 1;\nconst bar = foo + 1;');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'b.ts'), 'export const foo = 2;');

    const results = await service.searchInFiles(tmpDir, 'foo', {
      caseSensitive: false,
      isRegex: false,
      wholeWord: false,
      includeGlob: '',
      excludeGlob: '',
    });

    expect(results).toHaveLength(2);
    const aResult = results.find((r) => r.relativePath === 'a.ts');
    expect(aResult?.matches).toEqual([
      { line: 1, text: 'const foo = 1;', matchStart: 6, matchEnd: 9 },
      { line: 2, text: 'const bar = foo + 1;', matchStart: 12, matchEnd: 15 },
    ]);
  });

  it('searchInFiles excludes directories matching excludeGlob and dotfiles', async () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'x.ts'), 'foo');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'y.ts'), 'foo');
    fs.writeFileSync(path.join(tmpDir, 'real.ts'), 'foo');

    const results = await service.searchInFiles(tmpDir, 'foo', {
      caseSensitive: false,
      isRegex: false,
      wholeWord: false,
      includeGlob: '',
      excludeGlob: '',
    });

    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe('real.ts');
  });

  it('searchInFiles honors includeGlob to restrict by extension', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'foo');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), 'foo');

    const results = await service.searchInFiles(tmpDir, 'foo', {
      caseSensitive: false,
      isRegex: false,
      wholeWord: false,
      includeGlob: '*.ts',
      excludeGlob: '',
    });

    expect(results.map((r) => r.relativePath)).toEqual(['a.ts']);
  });

  it('searchInFiles returns empty array for an invalid regex query instead of throwing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'foo');

    const results = await service.searchInFiles(tmpDir, '(unterminated', {
      caseSensitive: false,
      isRegex: true,
      wholeWord: false,
      includeGlob: '',
      excludeGlob: '',
    });

    expect(results).toEqual([]);
  });

  it('listAllFiles lists relative, forward-slashed paths, excluding node_modules/.git, sorted', async () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'x.ts'), '');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), '');

    const files = await service.listAllFiles(tmpDir);

    expect(files).toEqual(['a.ts', 'src/b.ts']);
  });
});
