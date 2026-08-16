/** Canonical shapes for the db:* IPC boundary — deliberately mirror sql.js's raw row shapes (snake_case, 0/1, JSON strings), not a clean domain model. */

export interface FeatureFlagRow {
  name: string;
  is_enabled: number;
  description: string;
  updated_at: number;
}

/** A flag's User value merged with its per-workspace override; `workspace_enabled` is null when no override exists (inherits `user_enabled`). */
export interface EffectiveFeatureFlagRow {
  name: string;
  description: string;
  user_enabled: number;
  workspace_enabled: number | null;
}

export type SettingsMap = Record<string, string>;

export interface ConversationRow {
  id: string;
  project_id: string;
  title: string;
  messages: string;
  updated_at: number;
}

// Rows written by main/services/indexer.ts, read by the Code Map's ImpactAnalysisService.
export interface SymbolRow {
  id: string;
  project_id: string;
  file_path: string;
  name: string;
  kind: string;
  line_number: number;
  column_number: number;
  container_name: string | null;
}

export interface ImportRow {
  id: string;
  project_id: string;
  file_path: string;
  module_name: string;
  /** JSON-stringified string[] — see indexer.ts's parseImports. */
  imported_symbols: string;
}

export interface RouteRow {
  id: string;
  project_id: string;
  /** `"METHOD /path"`, e.g. "GET /api/users" — method and pattern are concatenated at index time, not stored separately. */
  path_pattern: string;
  handler: string | null;
  file_path: string;
}

export interface FrontendCallSiteRow {
  id: string;
  project_id: string;
  file_path: string;
  method: string;
  url_pattern: string;
  caller_symbol: string | null;
  line_number: number;
}

export interface CommandRow {
  id: string;
  name: string;
  category: string;
  description: string;
  source: string;
}

export interface KeybindingRow {
  command_id: string;
  key_combination: string;
  platform: string;
  profile_id: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  created_at: number;
}

export interface ExtensionRow {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  source_type: string;
  is_enabled: number;
  provides: string;
  depends_on: string;
  categories: string;
  tags: string;
  manifest_json: string;
}

/** What the renderer sends when saving an extension — a defensive mix of camelCase and snake_case since call sites aren't consistent. */
export interface SaveExtensionInput {
  id: string;
  name: string;
  version: string;
  description?: string;
  publisher?: string;
  type?: string;
  source_type?: string;
  isEnabled?: boolean;
  provides?: string[] | string;
  dependsOn?: string[] | string;
  categories?: string[] | string;
  tags?: string[] | string;
  manifestJson?: string;
  manifest_json?: string;
}

export interface ThemeRow {
  id: string;
  name: string;
  label: string;
  bg_primary: string;
  bg_secondary: string;
  bg_tertiary: string;
  border_color: string;
  accent_color: string;
  accent_secondary: string;
  text_primary: string;
  text_secondary: string;
  text_muted: string;
  is_default: number;
}

/** What the renderer sends when saving a theme (ThemeCreator.tsx). */
export interface SaveThemeInput {
  id: string;
  name: string;
  label?: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  borderColor: string;
  accentColor: string;
  accentSecondary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  isDefault?: boolean;
}

export interface ProjectRuleRow {
  id: string;
  project_id: string;
  rule_text: string;
  is_active: number;
}

export interface ProjectMemoryRow {
  id: string;
  project_id: string;
  memory_key: string;
  memory_val: string;
  created_at: number;
}

export type DbIpcContract = {
  'db:getFlags': (projectId: string) => Promise<EffectiveFeatureFlagRow[]>;
  'db:setFlag': (name: string, isEnabled: boolean, projectId?: string) => Promise<boolean>;
  'db:clearWorkspaceFlagOverride': (name: string, projectId: string) => Promise<boolean>;
  'db:getSettings': (profileId?: string) => Promise<SettingsMap>;
  'db:setSetting': (key: string, value: string, profileId?: string) => Promise<boolean>;
  'db:getConversations': (projectId: string) => Promise<ConversationRow[]>;
  'db:saveConversation': (id: string, projectId: string, title: string, messages: string) => Promise<boolean>;
  'db:deleteConversation': (id: string) => Promise<boolean>;
  'db:getExtensions': (profileId?: string) => Promise<ExtensionRow[]>;
  'db:setExtensionEnabled': (id: string, isEnabled: boolean, profileId?: string) => Promise<boolean>;
  'db:saveExtension': (ext: SaveExtensionInput) => Promise<boolean>;
  'db:deleteExtension': (id: string) => Promise<boolean>;
  'db:getWorkspaceExtensionOverrides': (projectId: string) => Promise<Record<string, boolean>>;
  'db:setWorkspaceExtensionEnabled': (extensionId: string, projectId: string, isEnabled: boolean) => Promise<boolean>;
  'db:clearWorkspaceExtensionOverride': (extensionId: string, projectId: string) => Promise<boolean>;
  'db:getThemes': () => Promise<ThemeRow[]>;
  'db:saveTheme': (theme: SaveThemeInput) => Promise<boolean>;
  // Project rules & memory injected into every chat prompt, scoped by project_id; save channels are upserts.
  'db:getProjectRules': (projectId: string) => Promise<ProjectRuleRow[]>;
  'db:saveProjectRule': (id: string, projectId: string, ruleText: string) => Promise<boolean>;
  'db:setProjectRuleActive': (id: string, isActive: boolean) => Promise<boolean>;
  'db:deleteProjectRule': (id: string) => Promise<boolean>;
  'db:getProjectMemories': (projectId: string) => Promise<ProjectMemoryRow[]>;
  'db:saveProjectMemory': (id: string, projectId: string, memoryKey: string, memoryVal: string) => Promise<boolean>;
  'db:deleteProjectMemory': (id: string) => Promise<boolean>;
  'db:getCommands': () => Promise<CommandRow[]>;
  'db:getKeybindings': (platform: string, profileId?: string) => Promise<KeybindingRow[]>;
  'db:setKeybinding': (commandId: string, keyCombination: string, platform: string, profileId?: string) => Promise<boolean>;
  'db:resetKeybindings': (platform: string, profileId?: string) => Promise<boolean>;
  'db:getProfiles': () => Promise<ProfileRow[]>;
  'db:createProfile': (id: string, name: string) => Promise<boolean>;
  'db:renameProfile': (id: string, name: string) => Promise<boolean>;
  'db:deleteProfile': (id: string) => Promise<boolean>;
};
