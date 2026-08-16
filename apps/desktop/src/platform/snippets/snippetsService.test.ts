import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SnippetsService } from './snippetsService';
import { SNIPPET_TEMPLATES } from './snippetTemplates';
import { FileSystemService } from '../fs';
import { FakeLogService } from '../log';

describe('SnippetsService (real fs, real temp dir, no mocking)', () => {
  let tmpDir: string;
  let snippetsDir: string;
  let extDir: string;
  let log: FakeLogService;
  let service: SnippetsService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-snippets-service-test-'));
    snippetsDir = path.join(tmpDir, 'snippets');
    fs.mkdirSync(snippetsDir, { recursive: true });
    extDir = path.join(tmpDir, 'ext-files');
    fs.mkdirSync(extDir, { recursive: true });
    log = new FakeLogService();
    service = new SnippetsService(new FileSystemService(new FakeLogService()), log);
    await service.initialize(snippetsDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses real JSONC content — comments and a trailing comma — correctly', async () => {
    fs.writeFileSync(
      path.join(snippetsDir, 'javascript.json'),
      `{
        // a comment
        "Log": {
          "prefix": "log",
          "body": ["console.log($1);"],
          "description": "Log something",
        },
      }`,
    );

    const result = await service.getSnippetsForLanguage('javascript', []);

    expect(result).toEqual([
      { name: 'Log', prefix: 'log', body: ['console.log($1);'], description: 'Log something', source: 'user', extensionId: undefined },
    ]);
  });

  it('merges a real user file with a real extension-contributed file, tagging source/extensionId correctly', async () => {
    fs.writeFileSync(path.join(snippetsDir, 'javascript.json'), JSON.stringify({ 'User Snippet': { prefix: 'u', body: 'user' } }));
    const extFile = path.join(extDir, 'javascript.json');
    fs.writeFileSync(extFile, JSON.stringify({ 'Ext Snippet': { prefix: 'e', body: 'ext' } }));

    const result = await service.getSnippetsForLanguage('javascript', [
      { extensionId: 'ext.demo', language: 'javascript', absolutePath: extFile },
    ]);

    expect(result).toContainEqual({ name: 'User Snippet', prefix: 'u', body: 'user', description: undefined, source: 'user', extensionId: undefined });
    expect(result).toContainEqual({ name: 'Ext Snippet', prefix: 'e', body: 'ext', description: undefined, source: 'extension', extensionId: 'ext.demo' });
  });

  it('returns only extension entries when no user file exists, without throwing', async () => {
    const extFile = path.join(extDir, 'javascript.json');
    fs.writeFileSync(extFile, JSON.stringify({ 'Ext Snippet': { prefix: 'e', body: 'ext' } }));

    const result = await service.getSnippetsForLanguage('javascript', [
      { extensionId: 'ext.demo', language: 'javascript', absolutePath: extFile },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('extension');
  });

  it('a malformed snippet file is logged and contributes nothing, rather than throwing', async () => {
    fs.writeFileSync(path.join(snippetsDir, 'javascript.json'), '{ not valid json');

    const result = await service.getSnippetsForLanguage('javascript', []);

    expect(result).toEqual([]);
    expect(log.errors.length).toBeGreaterThan(0);
  });

  it('ensureUserSnippetFile creates the generic starter content for a non-curated language', async () => {
    const filePath = await service.ensureUserSnippetFile('plaintext');

    expect(filePath).toBe(path.join(snippetsDir, 'plaintext.json'));
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('plaintext snippets');
  });

  it('ensureUserSnippetFile creates curated starter content for a language in SNIPPET_TEMPLATES', async () => {
    const filePath = await service.ensureUserSnippetFile('python');

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('Place your');
    const parsed = JSON.parse(content);
    expect(parsed.Print.prefix).toBe('print');
  });

  it('every SNIPPET_TEMPLATES entry is valid JSON with non-empty prefix/body on every snippet', () => {
    for (const [languageId, raw] of Object.entries(SNIPPET_TEMPLATES)) {
      const parsed = JSON.parse(raw);
      const entries = Object.entries(parsed as Record<string, { prefix: unknown; body: unknown }>);
      expect(entries.length, `${languageId} template should define at least one snippet`).toBeGreaterThan(0);
      for (const [name, def] of entries) {
        expect(def.prefix, `${languageId}.${name}.prefix`).toBeTruthy();
        expect(def.body, `${languageId}.${name}.body`).toBeTruthy();
      }
    }
  });

  it('listUserSnippetFiles returns an empty array when no snippet files exist', async () => {
    expect(await service.listUserSnippetFiles()).toEqual([]);
  });

  it('listUserSnippetFiles returns language ids (extension stripped), ignoring non-.json files', async () => {
    await service.ensureUserSnippetFile('python');
    await service.ensureUserSnippetFile('javascript');
    fs.writeFileSync(path.join(snippetsDir, 'notes.txt'), 'not a snippet file');

    const result = await service.listUserSnippetFiles();

    expect(result.sort()).toEqual(['javascript', 'python']);
  });

  it('getUserSnippetFileContent/writeUserSnippetFileContent round-trip raw text byte-identical, comments included', async () => {
    const raw = '{\n\t// a real comment\n\t"Log": { "prefix": "log", "body": ["console.log($1);"] }\n}\n';
    await service.writeUserSnippetFileContent('javascript', raw);

    const readBack = await service.getUserSnippetFileContent('javascript');

    expect(readBack).toBe(raw);
  });

  it('writeUserSnippetFileContent overwrites an existing file, unlike ensureUserSnippetFile', async () => {
    const filePath = await service.ensureUserSnippetFile('python');
    const original = fs.readFileSync(filePath, 'utf-8');

    await service.writeUserSnippetFileContent('python', '{ "Replaced": { "prefix": "r", "body": "r" } }');

    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).not.toBe(original);
    expect(JSON.parse(updated)).toEqual({ Replaced: { prefix: 'r', body: 'r' } });
  });

  it('ensureUserSnippetFile does not overwrite an already-edited file on a second call', async () => {
    const filePath = await service.ensureUserSnippetFile('python');
    fs.writeFileSync(filePath, JSON.stringify({ 'My Snippet': { prefix: 'm', body: 'mine' } }));

    const secondPath = await service.ensureUserSnippetFile('python');

    expect(secondPath).toBe(filePath);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ 'My Snippet': { prefix: 'm', body: 'mine' } });
  });

  it('throws a clear error if used before initialize()', async () => {
    const uninitialized = new SnippetsService(new FileSystemService(new FakeLogService()), new FakeLogService());
    await expect(uninitialized.ensureUserSnippetFile('javascript')).rejects.toThrow(/initialize/);
  });
});
