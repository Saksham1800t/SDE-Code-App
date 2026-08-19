import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import type {
  ExtensionManifest,
  ExtensionScaffoldPublishPayload,
  ExtensionScaffoldPublishResult,
} from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { resolveServerBaseUrl } from '../../shared/serverConfig';

export interface IExtensionMarketplaceService {
  /** Must be called with a writable directory (userData/extensions in production — host/index.ts does this)
   * before use. Without it, extensionsDir() falls back to a path derived from __dirname, which in the
   * packaged app resolves inside the read-only app.asar and throws ENOTDIR on any write. Same shape as
   * SnippetsService.initialize(); tests point this at a temp directory. */
  initialize(extensionsDirPath?: string): void;
  scaffoldAndPublish(payload: ExtensionScaffoldPublishPayload): Promise<ExtensionScaffoldPublishResult>;
  downloadAndInstall(downloadUrl: string, extensionId: string, version: string): Promise<ExtensionManifest>;
}

export const IExtensionMarketplaceService = createServiceIdentifier<IExtensionMarketplaceService>('extensionMarketplaceService');

/** Both directions (publish to / install from the marketplace) of one concern, sharing the same directory and zip/extract mechanics — one contract per concern, same granularity as GitService/DatabaseService. */
export class ExtensionMarketplaceService implements IExtensionMarketplaceService {
  static readonly inject = [ILogService] as const;

  private overriddenExtensionsDir: string | null = null;

  constructor(private readonly logService: ILogService) {}

  initialize(extensionsDirPath?: string): void {
    this.overriddenExtensionsDir = extensionsDirPath ?? null;
  }

  private extensionsDir(): string {
    // Vite bundles the whole main process into one output file, so __dirname reflects the bundle's location (dist-electron/main/), not this source file's own directory.
    const dir = this.overriddenExtensionsDir ?? path.join(__dirname, '../../extensions');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private zipDirectory(sourceDir: string, zipPath: string): void {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    const zipPathSafe = zipPath.replace(/\\/g, '/');
    const sourceDirSafe = sourceDir.replace(/\\/g, '/');
    // execFileSync (argv array, no shell) instead of execSync — the previous quoted-string interpolation let a path with `"`/`` ` ``/`$(...)` inject shell commands.
    execFileSync('tar', ['--force-local', '-acf', zipPathSafe, '-C', sourceDirSafe, '.']);
  }

  private extractZip(zipPath: string, targetDir: string): void {
    const zipPathSafe = zipPath.replace(/\\/g, '/');
    const targetDirSafe = targetDir.replace(/\\/g, '/');
    execFileSync('tar', ['--force-local', '-xf', zipPathSafe, '-C', targetDirSafe]);
  }

  async scaffoldAndPublish(payload: ExtensionScaffoldPublishPayload): Promise<ExtensionScaffoldPublishResult> {
    const { id, name, version, description, publisher, provides, dependsOn, templateConfig, categories, tags, isPublic, token } = payload;
    const extensionsDir = this.extensionsDir();

    // 1. Create a temporary folder — unique per call (not a fixed name) so two overlapping publishes can't delete or overwrite each other's in-flight files.
    const callId = crypto.randomUUID();
    const tempDir = path.join(extensionsDir, `temp-publish-${callId}`);
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // 2. Generate manifest.json
    let finalProvides: any = provides;
    let contributes: Record<string, unknown> | undefined;
    // Files beyond manifest.json/dist/index.js that must exist before zipping — the snippets branch needs a real snippet-body file since SnippetsRegistry reads it at install time.
    const extraFiles: Array<{ relPath: string; content: string }> = [];

    if (templateConfig && templateConfig.templateType === 'theme') {
      const colors = templateConfig.themeColors;
      finalProvides = {
        theme: {
          name,
          colors: {
            '--bg-primary': colors.bgPrimary,
            '--bg-secondary': colors.bgSecondary,
            '--text-primary': colors.textPrimary,
            '--text-secondary': colors.textSecondary,
            '--accent-cyan': colors.accentCyan,
            '--accent-cyan-glow': colors.accentGlow,
            '--border-color': colors.borderColor,
          },
        },
      };
    } else if (templateConfig && templateConfig.templateType === 'snippets') {
      const lang = templateConfig.languageId;
      contributes = { snippets: [{ language: lang, path: `snippets/${lang}.json` }] };
      extraFiles.push({
        relPath: path.join('snippets', `${lang}.json`),
        content: JSON.stringify(templateConfig.snippetsBody, null, 2),
      });
    }

    const manifest: any = { id, name, version, description, publisher, provides: finalProvides, dependsOn };
    if (contributes) manifest.contributes = contributes;
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    for (const f of extraFiles) {
      const fullPath = path.join(tempDir, f.relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content);
    }

    // 3. Generate compiled index.js. Themes must actually call registerTheme() — this used to
    // be a bare console.log stub, so a published theme's colors sat in the manifest as inert
    // metadata and the theme never appeared as a selectable option anywhere. The registration
    // id is the theme's own display name (not the extension's manifest id) so it also shows up
    // correctly labeled in the theme picker, which reads a registration's id as its label.
    let script: string;
    if (templateConfig && templateConfig.templateType === 'theme') {
      const colors = templateConfig.themeColors;
      const variables = {
        bgPrimary: colors.bgPrimary,
        bgSecondary: colors.bgSecondary,
        textPrimary: colors.textPrimary,
        textSecondary: colors.textSecondary,
        accentCyan: colors.accentCyan,
        accentCyanGlow: colors.accentGlow,
        borderColor: colors.borderColor,
      };
      script = `const { registerTheme } = require('@sde-code/sdk');\nregisterTheme(${JSON.stringify(name)}, ${JSON.stringify(variables)});\nconsole.log("Loaded extension: ${name}");`;
    } else {
      script = `console.log("Loaded extension: ${name}");`;
    }
    fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'dist/index.js'), script);

    // 4. Zip the folder
    const zipPath = path.join(extensionsDir, `temp-bundle-${callId}.zip`);
    this.zipDirectory(tempDir, zipPath);

    try {
      // 5. Upload via multipart form-data to the SDE server
      const fileBuffer = fs.readFileSync(zipPath);
      const boundary = '----WebKitFormBoundarySDECodeIDE';

      // Construct raw multipart request body since native FormData isn't
      // easily available for this Node/fetch combination without extra deps.
      const multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${id}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="version"\r\n\r\n${version}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description || ''}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="publisher"\r\n\r\n${publisher}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="provides"\r\n\r\n${JSON.stringify(provides)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="dependsOn"\r\n\r\n${JSON.stringify(dependsOn)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="templateConfig"\r\n\r\n${JSON.stringify(templateConfig || {})}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="categories"\r\n\r\n${JSON.stringify(categories || [])}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${JSON.stringify(tags || [])}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="isPublic"\r\n\r\n${isPublic === false ? 'false' : 'true'}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="bundle"; filename="bundle.zip"\r\nContent-Type: application/zip\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await fetch(`${resolveServerBaseUrl(process.env.VITE_SERVER_URL)}/api/extensions/publish`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Publish failed.');
      }
      return data;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
  }

  async downloadAndInstall(downloadUrl: string, extensionId: string, version: string): Promise<ExtensionManifest> {
    // extensionId/version come from an untrusted marketplace response and get path.join()'d below, which resolves ".." — only the real extension-id charset is allowed through.
    const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
    if (!SAFE_ID_PATTERN.test(extensionId) || !SAFE_ID_PATTERN.test(version)) {
      throw new Error('Invalid extension id or version.');
    }

    const extensionsDir = this.extensionsDir();
    const tempZipPath = path.join(extensionsDir, `temp-${extensionId}-${version}.zip`);
    const targetExtractDir = path.join(extensionsDir, extensionId);

    if (fs.existsSync(targetExtractDir)) {
      fs.rmSync(targetExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetExtractDir, { recursive: true });

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download extension package. HTTP Status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(tempZipPath, Buffer.from(arrayBuffer));

      try {
        this.extractZip(tempZipPath, targetExtractDir);
      } catch (tarErr: any) {
        throw new Error(`Extraction failed. Ensure tar is available: ${tarErr.message}`);
      }

      const manifestPath = path.join(targetExtractDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Extension manifest.json is missing from zip bundle.');
      }

      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err: any) {
      if (fs.existsSync(targetExtractDir)) {
        fs.rmSync(targetExtractDir, { recursive: true, force: true });
      }
      this.logService.error(`Failed to install extension "${extensionId}@${version}":`, err);
      throw err;
    } finally {
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
    }
  }
}
