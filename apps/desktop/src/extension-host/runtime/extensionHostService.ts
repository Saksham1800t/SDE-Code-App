import fs from 'fs';
import path from 'path';
import type { ExtensionManifest } from '@sde-code/protocol';
import { Disposable, IDisposable } from '../../kernel';
import { createServiceIdentifier, ILogService } from '../../platform';
import { createInProcessTransportPair, IExtensionTransport, RpcExtensionSide, RpcHost } from '../protocol';
import { createSandboxRequire } from '../sandbox/sdkBridge';
import { loadExtensionInSandbox } from '../sandbox/vmSandbox';
import { matchesActivationEvent } from '../activation/activationEvents';

/** What a `register()` call produced, tagged with which extension it came from. */
export interface ExtensionRegistration {
  extensionId: string;
  kind: string;
  payload: unknown;
}

export interface LoadedExtensionInfo {
  manifest: ExtensionManifest;
  activated: boolean;
}

/** One extension's declarative contribution of a given kind, read straight off its manifest — no activation involved. */
export interface StaticContribution<T> {
  extensionId: string;
  rootDir: string;
  value: T;
}

export interface IExtensionHostService extends IDisposable {
  /** Scans `extensionsRootDir` for `<id>/manifest.json` subfolders and prepares (but does not run) each one found. Returns how many were discovered. */
  discoverExtensions(extensionsRootDir: string): Promise<number>;
  /** Activates every not-yet-activated extension whose manifest declares an activationEvent matching `event` (or `"*"`). */
  fireActivationEvent(event: string): Promise<void>;
  /** Every registration of the given kind (`'command'`, `'statusBarItem'`, `'theme'`, etc.) across all extensions so far. */
  getRegistrations(kind: string): readonly ExtensionRegistration[];
  /** Every discovered extension's declarative `manifest.contributes[kind]` value, activated or not — unlike getRegistrations(), never touches the sandbox/RPC layer. */
  getStaticContributions<T>(kind: string): StaticContribution<T>[];
  /** Invokes a callback a specific extension registered, by the ID that came back in its registration payload. */
  invoke<T = unknown>(extensionId: string, callbackId: string, args: unknown[]): Promise<T>;
  /** For introspection/tests — every discovered extension's manifest and current activation state. */
  getLoadedExtensions(): readonly LoadedExtensionInfo[];
}

export const IExtensionHostService = createServiceIdentifier<IExtensionHostService>('extensionHostService');

interface LoadedExtension {
  manifest: ExtensionManifest;
  rootDir: string;
  activated: boolean;
  hostTransport: IExtensionTransport;
  extensionTransport: IExtensionTransport;
  extensionSide: RpcExtensionSide;
  rpcHost: RpcHost;
}

export class ExtensionHostService extends Disposable implements IExtensionHostService {
  static readonly inject = [ILogService] as const;

  private readonly extensions = new Map<string, LoadedExtension>();
  private readonly registrations: ExtensionRegistration[] = [];

  constructor(private readonly logService: ILogService) {
    super();
  }

  async discoverExtensions(extensionsRootDir: string): Promise<number> {
    let entries: string[];
    try {
      entries = fs.readdirSync(extensionsRootDir);
    } catch (err) {
      this.logService.error('Failed to read extensions directory:', err);
      return 0;
    }

    let count = 0;
    for (const entry of entries) {
      const extDir = path.join(extensionsRootDir, entry);
      const manifestPath = path.join(extDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      let manifest: ExtensionManifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
      } catch (err) {
        this.logService.error(`Failed to parse manifest.json in ${extDir}:`, err);
        continue;
      }

      if (this.extensions.has(manifest.id)) {
        this.logService.error(`Duplicate extension ID "${manifest.id}" (${extDir}) — skipping.`);
        continue;
      }

      const [hostTransport, extensionTransport] = createInProcessTransportPair();
      this._register(hostTransport);
      this._register(extensionTransport);
      const extensionSide = this._register(new RpcExtensionSide(extensionTransport));
      const rpcHost = this._register(
        new RpcHost(hostTransport, (kind, payload) => {
          this.registrations.push({ extensionId: manifest.id, kind, payload });
        }),
      );

      this.extensions.set(manifest.id, {
        manifest,
        rootDir: extDir,
        activated: false,
        hostTransport,
        extensionTransport,
        extensionSide,
        rpcHost,
      });
      count++;
    }
    return count;
  }

  async fireActivationEvent(event: string): Promise<void> {
    for (const ext of this.extensions.values()) {
      if (ext.activated) continue;
      if (!matchesActivationEvent(ext.manifest.activationEvents ?? [], event)) continue;
      await this.activate(ext);
    }
  }

  private async activate(ext: LoadedExtension): Promise<void> {
    // Set before running so a re-entrant activation event can't re-enter activate() for the same extension.
    ext.activated = true;

    try {
      const entryRelativePath = ext.manifest.main ?? 'dist/index.js';
      const entryPath = path.join(ext.rootDir, entryRelativePath);
      const sourceCode = fs.readFileSync(entryPath, 'utf-8');
      const requireFn = createSandboxRequire(ext.extensionSide);

      const moduleExports = loadExtensionInSandbox(sourceCode, entryPath, requireFn);
      await moduleExports.activate?.();

      this.logService.info(`Activated extension "${ext.manifest.id}".`);
    } catch (err) {
      this.logService.error(`Failed to activate extension "${ext.manifest.id}":`, err);
    }
  }

  getRegistrations(kind: string): readonly ExtensionRegistration[] {
    return this.registrations.filter((r) => r.kind === kind);
  }

  getStaticContributions<T>(kind: string): StaticContribution<T>[] {
    const results: StaticContribution<T>[] = [];
    for (const ext of this.extensions.values()) {
      const contributes = ext.manifest.contributes as Record<string, unknown> | undefined;
      const value = contributes?.[kind];
      if (value === undefined) continue;
      results.push({ extensionId: ext.manifest.id, rootDir: ext.rootDir, value: value as T });
    }
    return results;
  }

  invoke<T = unknown>(extensionId: string, callbackId: string, args: unknown[]): Promise<T> {
    const ext = this.extensions.get(extensionId);
    if (!ext) {
      return Promise.reject(new Error(`Unknown extension: ${extensionId}`));
    }
    return ext.rpcHost.invoke<T>(callbackId, args);
  }

  getLoadedExtensions(): readonly LoadedExtensionInfo[] {
    return Array.from(this.extensions.values()).map((ext) => ({
      manifest: ext.manifest,
      activated: ext.activated,
    }));
  }
}
