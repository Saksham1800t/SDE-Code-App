import type { ExtensionManifest } from './extension';

/** Namespaced `extensionMarketplace:` to stay distinct from `extensions:` (activated-extension data) and `db:*Extension*` (local CRUD). */
export type ExtensionTemplateConfig =
  | {
      templateType: 'theme';
      themeColors: {
        bgPrimary: string;
        bgSecondary: string;
        textPrimary: string;
        textSecondary: string;
        accentCyan: string;
        accentGlow: string;
        borderColor: string;
      };
    }
  | {
      templateType: 'snippets';
      languageId: string;
      snippetsBody: Record<string, unknown>;
    };

export interface ExtensionScaffoldPublishPayload {
  id: string;
  name: string;
  version: string;
  description?: string;
  publisher: string;
  provides?: string[];
  dependsOn?: string[];
  templateConfig?: ExtensionTemplateConfig;
  categories?: string[];
  tags?: string[];
  isPublic?: boolean;
  token: string;
}

export interface ExtensionScaffoldPublishResult {
  message: string;
  extension: {
    id: string;
    name: string;
    version: string;
    publisher: string;
  };
}

export type ExtensionMarketplaceIpcContract = {
  'extensionMarketplace:scaffoldPublish': (payload: ExtensionScaffoldPublishPayload) => Promise<ExtensionScaffoldPublishResult>;
  'extensionMarketplace:downloadInstall': (downloadUrl: string, extensionId: string, version: string) => Promise<ExtensionManifest>;
};
