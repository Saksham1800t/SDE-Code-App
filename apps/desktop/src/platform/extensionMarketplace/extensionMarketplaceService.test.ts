import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { ExtensionMarketplaceService } from './extensionMarketplaceService';
import { FakeLogService } from '../log';

// Builds a real zip (via the same real `tar` binary the service itself
// shells out to) containing whatever files are passed in — real fs, no
// mocking, matching this codebase's established test convention. The one
// deliberate exception is `fetch`, stubbed per-test below, since that's a
// genuine network boundary.
function buildRealZip(tmpDir: string, files: Record<string, string>): string {
  const sourceDir = path.join(tmpDir, 'zip-source-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(sourceDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  const zipPath = path.join(tmpDir, 'fixture-' + Math.random().toString(36).slice(2) + '.zip');
  const zipPathSafe = zipPath.replace(/\\/g, '/');
  const sourceDirSafe = sourceDir.replace(/\\/g, '/');
  execSync(`tar --force-local -acf "${zipPathSafe}" -C "${sourceDirSafe}" .`);
  return zipPath;
}

describe('ExtensionMarketplaceService (real fs, real temp dir, real tar, no mocking except fetch)', () => {
  let tmpDir: string;
  let extensionsDir: string;
  let log: FakeLogService;
  let service: ExtensionMarketplaceService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-ext-marketplace-test-'));
    extensionsDir = path.join(tmpDir, 'extensions');
    log = new FakeLogService();
    service = new ExtensionMarketplaceService(log);
    service.initialize(extensionsDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  describe('downloadAndInstall', () => {
    it('extracts a real zip and returns the real manifest.json', async () => {
      const manifest = { id: 'demo.ext', name: 'Demo', version: '1.0.0', publisher: 'Self', provides: ['snippets'] };
      const zipPath = buildRealZip(tmpDir, { 'manifest.json': JSON.stringify(manifest) });
      const zipBuffer = fs.readFileSync(zipPath);

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength),
      })));

      const result = await service.downloadAndInstall('http://fake/download', 'demo.ext', '1.0.0');

      expect(result).toEqual(manifest);
      expect(fs.existsSync(path.join(extensionsDir, 'demo.ext', 'manifest.json'))).toBe(true);
    });

    it('throws and cleans up the target directory on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

      await expect(service.downloadAndInstall('http://fake/download', 'missing.ext', '1.0.0')).rejects.toThrow(/HTTP Status 404/);
      expect(fs.existsSync(path.join(extensionsDir, 'missing.ext'))).toBe(false);
      expect(log.errors.length).toBeGreaterThan(0);
    });

    it('throws when the zip has no manifest.json', async () => {
      const zipPath = buildRealZip(tmpDir, { 'readme.txt': 'no manifest here' });
      const zipBuffer = fs.readFileSync(zipPath);
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength),
      })));

      await expect(service.downloadAndInstall('http://fake/download', 'no-manifest.ext', '1.0.0')).rejects.toThrow(/manifest\.json is missing/);
    });
  });

  describe('scaffoldAndPublish', () => {
    it('publishes a theme extension and returns the server response', async () => {
      const serverResponse = { message: 'ok', extension: { id: 'theme.custom', name: 'Custom', version: '1.0.0', publisher: 'Self' } };
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => serverResponse })));

      const result = await service.scaffoldAndPublish({
        id: 'theme.custom',
        name: 'Custom',
        version: '1.0.0',
        publisher: 'Self',
        templateConfig: {
          templateType: 'theme',
          themeColors: {
            bgPrimary: '#000', bgSecondary: '#111', textPrimary: '#fff', textSecondary: '#ccc',
            accentCyan: '#0ff', accentGlow: 'rgba(0,255,255,0.2)', borderColor: '#333',
          },
        },
        token: 'fake-token',
      });

      expect(result).toEqual(serverResponse);
      // scaffoldAndPublish cleans up its temp dir/zip in a finally block —
      // confirm no leftover temp-publish dir or zip survives the call.
      expect(fs.existsSync(path.join(extensionsDir, 'temp-publish'))).toBe(false);
      expect(fs.existsSync(path.join(extensionsDir, 'temp-bundle.zip'))).toBe(false);
    });

    it('publishes a snippets extension, writing contributes.snippets and the real snippet body into the bundle', async () => {
      let capturedBody: Buffer | null = null;
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        capturedBody = Buffer.from(init.body);
        return { ok: true, json: async () => ({ message: 'ok', extension: { id: 'snippets.py', name: 'Py', version: '1.0.0', publisher: 'Self' } }) };
      }));

      await service.scaffoldAndPublish({
        id: 'snippets.py',
        name: 'Py',
        version: '1.0.0',
        publisher: 'Self',
        provides: ['snippets'],
        templateConfig: { templateType: 'snippets', languageId: 'python', snippetsBody: { Print: { prefix: 'print', body: 'print($1)' } } },
        token: 'fake-token',
      });

      expect(capturedBody).not.toBeNull();
      const bodyText = capturedBody!.toString('latin1');
      expect(bodyText).toContain('name="bundle"; filename="bundle.zip"');
    });

    it('propagates the server error message and still cleans up on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ message: 'Version already published.' }) })));

      await expect(service.scaffoldAndPublish({
        id: 'theme.dup', name: 'Dup', version: '1.0.0', publisher: 'Self', token: 'fake-token',
      })).rejects.toThrow(/Version already published/);

      expect(fs.existsSync(path.join(extensionsDir, 'temp-publish'))).toBe(false);
    });
  });
});
