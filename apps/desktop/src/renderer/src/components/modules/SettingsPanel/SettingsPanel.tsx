import React, { useEffect, useState } from 'react';
import './SettingsPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { useThemeStore, getCustomThemes } from '../../../store/theme';
import { useFeatureFlagsStore, type FlagScope } from '../../../store/featureFlags';
import { useEditorSettingsStore } from '../../../store/editorSettings';
import { useTerminalSettingsStore } from '../../../store/terminalSettings';
import { useAgentStore } from '../../../store/agent';
import { useAgentProfilesStore } from '../../../store/agentProfiles';
import { useToolchainStore } from '../../../store/toolchain';
import { AGENT_POLICY_TOOL_NAMES, type AgentPolicyToolName, type AgentToolPolicy } from '@sde-code/protocol';
import { KeyboardShortcuts } from '../KeyboardShortcuts';
import { useAuthStore } from '../../../store/auth';
import { useSyncStore } from '../../../store/sync';
import { SyncTab } from './SyncTab';
import { McpServersTab } from './McpServersTab';
import { ExternalAgentsTab } from './ExternalAgentsTab';
import { SettingsSearchBar } from './SettingsSearchBar';
import { SettingsTOC, type SettingsCategory } from './SettingsTOC';
import { SettingRow } from './SettingRow';
import { Select } from '../../common/Select';
import { Input } from '../../common/Input';
import { Button } from '../../common/Button';
import { useExtensionsStore } from '../../../store/extensions';
import { getDefaultModelForProvider } from '../../../utils/aiModels';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const ALL_CATEGORIES: SettingsCategory[] = [
  { id: 'feature-toggles', label: 'Feature Toggles' },
  { id: 'text-editor', label: 'Text Editor' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai-provider', label: 'Active AI Provider' },
  { id: 'agent-profiles', label: 'Agent Profiles' },
  { id: 'credentials', label: 'AI Provider Credentials' },
  { id: 'cloud-sync', label: 'Cloud Sync' },
  { id: 'mcp-servers', label: 'MCP Servers' },
  { id: 'external-agents', label: 'External Agents' },
];

// Feature Toggles and Toolchain are the only per-workspace categories; everything else stays User-only (security-adjacent settings excluded from workspace scope).
const WORKSPACE_CATEGORIES: SettingsCategory[] = [
  { id: 'feature-toggles', label: 'Feature Toggles' },
  { id: 'toolchain', label: 'Toolchain' },
];

const AGENT_TOOL_LABELS: Record<AgentPolicyToolName, { title: string; description: string }> = {
  read_file: { title: 'Read File', description: 'Read the contents of a file in the workspace.' },
  list_directory: { title: 'List Directory', description: 'List files and subdirectories in the workspace.' },
  search_files: { title: 'Search Files', description: 'Search for text or a regex pattern across workspace files.' },
  propose_file_edit: { title: 'Edit File', description: 'Propose replacing a file\'s contents, staged for your review before anything is written.' },
  create_file: { title: 'Create File', description: 'Propose creating a new file, staged for your review before anything is written.' },
  delete_file: { title: 'Delete File', description: 'Propose deleting a file, staged for your review before anything is removed.' },
  run_terminal_command: { title: 'Run Terminal Command', description: 'Run a shell command in the workspace root.' },
};

const matches = (query: string, ...texts: string[]) =>
  !query || texts.some((t) => t.toLowerCase().includes(query.toLowerCase()));

export const SettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const { openTabs, activeTabPath } = useWorkspaceStore();
  const { currentTheme, setTheme, localThemes } = useThemeStore();
  const { featureFlags, loadFeatureFlags, toggleFeatureFlag, clearWorkspaceOverride } = useFeatureFlagsStore();
  const {
    fontSize: editorFontSize, setFontSize: setEditorFontSize,
    tabSize, setTabSize,
    wordWrap, setWordWrap,
    minimapEnabled, setMinimapEnabled,
    lineNumbers, setLineNumbers,
    showBreadcrumbs, setShowBreadcrumbs,
    inlayHintsEnabled, setInlayHintsEnabled,
    vimModeEnabled, setVimModeEnabled,
  } = useEditorSettingsStore();
  const {
    fontSize: terminalFontSize, setFontSize: setTerminalFontSize,
    cursorStyle, setCursorStyle,
    cursorBlink, setCursorBlink,
    scrollback, setScrollback,
  } = useTerminalSettingsStore();
  const {
    activeAIProvider,
    setActiveAIProvider,
    setActiveAIModel,
    inlineCompletionEnabled,
    setInlineCompletionEnabled
  } = useAgentStore();
  const { toolPolicies, activePreset, applyPreset, setToolPolicy } = useAgentProfilesStore();
  const { config: toolchainConfig, setToolchainPath, loadToolchain: loadToolchainConfig } = useToolchainStore();
  const [toolchainInputs, setToolchainInputs] = useState<{ pythonPath: string; nodePath: string }>({
    pythonPath: toolchainConfig.pythonPath || '',
    nodePath: toolchainConfig.nodePath || '',
  });
  useEffect(() => {
    setToolchainInputs({ pythonPath: toolchainConfig.pythonPath || '', nodePath: toolchainConfig.nodePath || '' });
  }, [toolchainConfig.pythonPath, toolchainConfig.nodePath]);
  // Re-reads .sde/toolchain.json for whichever workspace is active right now — covers switching
  // projects mid-session without an app restart, which the App.tsx startup load alone would miss.
  useEffect(() => {
    loadToolchainConfig();
  }, [loadToolchainConfig]);

  const activeEditorTab = openTabs.find((t) => t.path === activeTabPath);
  const isShortcutsTab = activeEditorTab?.isSettings && activeEditorTab.settingsType === 'shortcuts';

  const { user, isAuthenticated, login, register, logout, deleteAccount, error: authError, clearError, initialize: initAuth } = useAuthStore();
  const { isSyncEnabled, toggleSyncEnabled, pushSettings, pullSettings, lastSyncedAt, syncing, error: syncError, initializeSync } = useSyncStore();

  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  type ConnectionTestState = { status: 'testing' | 'success' | 'error'; message?: string };
  const [connectionTests, setConnectionTests] = useState<Record<string, ConnectionTestState>>({});

  const handleTestConnection = async (provider: string) => {
    const api = window.api;
    if (!api?.testAIConnection) return;
    setConnectionTests((prev) => ({ ...prev, [provider]: { status: 'testing' } }));
    try {
      const result = await api.testAIConnection(provider);
      setConnectionTests((prev) => ({
        ...prev,
        [provider]: { status: result.success ? 'success' : 'error', message: result.message },
      }));
    } catch (err) {
      setConnectionTests((prev) => ({
        ...prev,
        [provider]: { status: 'error', message: err instanceof Error ? err.message : 'Unknown error.' },
      }));
    }
  };

  const { extensions } = useExtensionsStore();
  const customThemes = React.useMemo(() => {
    const themesObj = getCustomThemes();
    return Object.keys(themesObj).map((key) => ({ name: key, label: themesObj[key].label }));
  }, [extensions, localThemes]);

  useEffect(() => { initAuth(); initializeSync(); }, []);
  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    const api = window.api;
    if (!api) return;
    try {
      setLoading(true);
      await loadFeatureFlags();
      const dbSettings = await api.getSettings();
      setSettings(dbSettings || {});
    } catch (err) {
      console.error('Failed to load settings from DB:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSetting = async (key: string, value: string) => {
    const api = window.api;
    if (!api) return;
    try {
      await api.setSetting(key, value);
      setSettings({ ...settings, [key]: value });
    } catch (err) {
      console.error('Failed to update setting:', err);
    }
  };

  const [scope, setScope] = useState<'user' | 'workspace'>('user');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('feature-toggles');

  const visibleCategories = scope === 'workspace' ? WORKSPACE_CATEGORIES : ALL_CATEGORIES;
  const effectiveCategory = visibleCategories.some((c) => c.id === activeCategory) ? activeCategory : visibleCategories[0].id;

  if (loading) {
    return <div className="sde-settings-loading">Loading configuration...</div>;
  }

  if (isShortcutsTab) {
    return <KeyboardShortcuts />;
  }

  const flagScope: FlagScope = scope;

  return (
    <div className="sde-settings-panel">
      <SettingsSearchBar value={searchQuery} onChange={setSearchQuery} />

      <div className="sde-settings-scope-tabs">
        {(['user', 'workspace'] as const).map((s) => (
          <button
            key={s}
            className={`sde-settings-scope-tab${scope === s ? ' active' : ''}`}
            onClick={() => setScope(s)}
          >
            {s === 'user' ? 'User' : 'Workspace'}
          </button>
        ))}
      </div>

      <div className="sde-settings-body-split">
        <SettingsTOC
          categories={visibleCategories}
          activeCategory={effectiveCategory}
          onSelect={setActiveCategory}
          onOpenShortcuts={scope === 'user' ? () => useWorkspaceStore.getState().openSettingsTab('shortcuts') : undefined}
        />

        <div className="sde-settings-content">
          {scope === 'workspace' && (
            <p className="sde-settings-scope-note">
              Only Feature Toggles and Toolchain support a per-workspace override. Everything else is User-only.
            </p>
          )}

          {effectiveCategory === 'feature-toggles' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Feature Toggles</h2>
              {featureFlags
                .filter((flag) => matches(searchQuery, flag.name.replace(/-/g, ' '), flag.description))
                .map((flag) => {
                  const value = flagScope === 'workspace' ? flag.workspaceValue ?? flag.userValue : flag.userValue;
                  const isOverridden = flagScope === 'workspace' && flag.workspaceValue !== null;
                  return (
                    <div key={flag.name} className="sde-setting-row-wrap">
                      <SettingRow
                        title={flag.name.replace(/-/g, ' ')}
                        description={flag.description}
                        boolean={{ checked: value, onChange: () => toggleFeatureFlag(flag.name, flagScope) }}
                      />
                      {flagScope === 'workspace' && isOverridden && (
                        <button className="sde-setting-inherit-link" onClick={() => clearWorkspaceOverride(flag.name)}>
                          Reset to User value
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {effectiveCategory === 'toolchain' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Toolchain</h2>
              <p className="sde-settings-scope-note">
                Stored in <code>.sde/toolchain.json</code> at the project root — travels with the project (safe to commit), not tied to your user account. Prepended to new terminals' PATH, so <code>python</code>/<code>node</code> (and any task or agent command that runs one) resolve to the interpreter picked here.
              </p>
              {matches(searchQuery, 'python interpreter path') && (
                <SettingRow title="Python Interpreter" description="Full path to the python(.exe) binary this project should use.">
                  <Input
                    placeholder="e.g. C:\Python312\python.exe"
                    value={toolchainInputs.pythonPath}
                    onChange={(e) => setToolchainInputs((s) => ({ ...s, pythonPath: e.target.value }))}
                    onBlur={() => setToolchainPath('pythonPath', toolchainInputs.pythonPath.trim())}
                  />
                </SettingRow>
              )}
              {matches(searchQuery, 'node.js interpreter path') && (
                <SettingRow title="Node.js Interpreter" description="Full path to the node(.exe) binary this project should use.">
                  <Input
                    placeholder="e.g. C:\Program Files\nodejs\node.exe"
                    value={toolchainInputs.nodePath}
                    onChange={(e) => setToolchainInputs((s) => ({ ...s, nodePath: e.target.value }))}
                    onBlur={() => setToolchainPath('nodePath', toolchainInputs.nodePath.trim())}
                  />
                </SettingRow>
              )}
            </div>
          )}

          {effectiveCategory === 'text-editor' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Text Editor</h2>
              {matches(searchQuery, 'font size') && (
                <SettingRow title="Font Size">
                  <Input
                    type="number"
                    value={String(editorFontSize)}
                    onChange={(e) => setEditorFontSize(Number(e.target.value) || 14)}
                  />
                </SettingRow>
              )}
              {matches(searchQuery, 'tab size') && (
                <SettingRow title="Tab Size">
                  <Input
                    type="number"
                    value={String(tabSize)}
                    onChange={(e) => setTabSize(Number(e.target.value) || 2)}
                  />
                </SettingRow>
              )}
              {matches(searchQuery, 'word wrap') && (
                <SettingRow
                  title="Word Wrap"
                  description="Wrap long lines to fit within the editor viewport."
                  boolean={{ checked: wordWrap === 'on', onChange: () => setWordWrap(wordWrap === 'on' ? 'off' : 'on') }}
                />
              )}
              {matches(searchQuery, 'minimap') && (
                <SettingRow
                  title="Minimap"
                  description="Shows a condensed preview of the file on the right edge of the editor."
                  boolean={{ checked: minimapEnabled, onChange: () => setMinimapEnabled(!minimapEnabled) }}
                />
              )}
              {matches(searchQuery, 'line numbers') && (
                <SettingRow
                  title="Line Numbers"
                  boolean={{ checked: lineNumbers === 'on', onChange: () => setLineNumbers(lineNumbers === 'on' ? 'off' : 'on') }}
                />
              )}
              {matches(searchQuery, 'breadcrumbs') && (
                <SettingRow
                  title="Breadcrumbs"
                  description="Shows the file path trail above the editor."
                  boolean={{ checked: showBreadcrumbs, onChange: () => setShowBreadcrumbs(!showBreadcrumbs) }}
                />
              )}
              {matches(searchQuery, 'inlay hints parameter names types') && (
                <SettingRow
                  title="Inlay Hints"
                  description="Shows inline parameter-name and inferred-type hints in TypeScript/JavaScript files."
                  boolean={{ checked: inlayHintsEnabled, onChange: () => setInlayHintsEnabled(!inlayHintsEnabled) }}
                />
              )}
              {matches(searchQuery, 'vim mode modal editing keybindings') && (
                <SettingRow
                  title="Vim Mode"
                  description="Modal editing with Vim keybindings (via monaco-vim). Shows the current mode in the status bar."
                  boolean={{ checked: vimModeEnabled, onChange: () => setVimModeEnabled(!vimModeEnabled) }}
                />
              )}
            </div>
          )}

          {effectiveCategory === 'terminal' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Terminal</h2>
              {matches(searchQuery, 'font size') && (
                <SettingRow title="Font Size">
                  <Input
                    type="number"
                    value={String(terminalFontSize)}
                    onChange={(e) => setTerminalFontSize(Number(e.target.value) || 14)}
                  />
                </SettingRow>
              )}
              {matches(searchQuery, 'cursor style') && (
                <SettingRow title="Cursor Style">
                  <Select value={cursorStyle} onChange={(e) => setCursorStyle(e.target.value as typeof cursorStyle)}>
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                    <option value="bar">Bar</option>
                  </Select>
                </SettingRow>
              )}
              {matches(searchQuery, 'cursor blink') && (
                <SettingRow
                  title="Cursor Blink"
                  boolean={{ checked: cursorBlink, onChange: () => setCursorBlink(!cursorBlink) }}
                />
              )}
              {matches(searchQuery, 'scrollback') && (
                <SettingRow title="Scrollback" description="Maximum number of lines kept in the terminal's scroll history.">
                  <Input
                    type="number"
                    value={String(scrollback)}
                    onChange={(e) => setScrollback(Number(e.target.value) || 1000)}
                  />
                </SettingRow>
              )}
            </div>
          )}

          {effectiveCategory === 'appearance' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Appearance</h2>
              {matches(searchQuery, 'color theme') && (
                <SettingRow title="Color Theme">
                  <Select value={currentTheme} onChange={(e) => setTheme(e.target.value)}>
                    {customThemes.map((t) => (
                      <option key={t.name} value={t.name}>{t.label}</option>
                    ))}
                  </Select>
                </SettingRow>
              )}
            </div>
          )}

          {effectiveCategory === 'ai-provider' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Active AI Provider</h2>
              {matches(searchQuery, 'model engine provider') && (
                <SettingRow title="Model Engine Provider">
                  <Select
                    value={activeAIProvider}
                    onChange={(e) => {
                      const newProvider = e.target.value;
                      setActiveAIProvider(newProvider);
                      setActiveAIModel(getDefaultModelForProvider(newProvider));
                    }}
                  >
                    <option value="gemini">Gemini (Google)</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Claude (Anthropic)</option>
                    <option value="ollama">Ollama (Local)</option>
                    <option value="lm-studio">LM Studio (Local)</option>
                  </Select>
                </SettingRow>
              )}
              {matches(searchQuery, 'inline completion', 'ai-suggested ghost text') && (
                <SettingRow
                  title="Inline Completion"
                  description="AI-suggested ghost text as you type, using the active provider above."
                  boolean={{ checked: inlineCompletionEnabled, onChange: () => setInlineCompletionEnabled(!inlineCompletionEnabled) }}
                />
              )}
            </div>
          )}

          {effectiveCategory === 'agent-profiles' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Agent Profiles</h2>
              {matches(searchQuery, 'preset read-only full access') && (
                <SettingRow
                  title="Preset"
                  description="Read-only allows the agent to explore the codebase but never edit files or run commands. Full Access runs every tool immediately, with no approval prompts — including terminal commands."
                >
                  <Select
                    value={activePreset}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'read-only' || v === 'full-access') applyPreset(v);
                    }}
                  >
                    <option value="custom" disabled={activePreset !== 'custom'}>Custom</option>
                    <option value="read-only">Read-only</option>
                    <option value="full-access">Full Access</option>
                  </Select>
                </SettingRow>
              )}
              {AGENT_POLICY_TOOL_NAMES.filter((name) => matches(searchQuery, AGENT_TOOL_LABELS[name].title, AGENT_TOOL_LABELS[name].description)).map((name) => (
                <SettingRow key={name} title={AGENT_TOOL_LABELS[name].title} description={AGENT_TOOL_LABELS[name].description}>
                  <Select
                    value={toolPolicies[name]}
                    onChange={(e) => setToolPolicy(name, e.target.value as AgentToolPolicy)}
                  >
                    <option value="allow">Allow — runs immediately</option>
                    <option value="ask">Ask — requires approval each time</option>
                    <option value="deny">Deny — unavailable to the agent</option>
                  </Select>
                </SettingRow>
              ))}
            </div>
          )}

          {effectiveCategory === 'credentials' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">AI Provider Credentials</h2>
              {[
                { key: 'gemini-key', label: 'Gemini API Key', placeholder: 'AIzaSy...', type: 'password', provider: 'gemini' },
                { key: 'openai-key', label: 'OpenAI API Key', placeholder: 'sk-proj-...', type: 'password', provider: 'openai' },
                { key: 'anthropic-key', label: 'Anthropic API Key', placeholder: 'sk-ant-...', type: 'password', provider: 'anthropic' },
                { key: 'ollama-url', label: 'Ollama Endpoint URL', placeholder: 'http://localhost:11434/v1/chat/completions', type: 'text', provider: 'ollama' },
                { key: 'lm-studio-url', label: 'LM Studio Endpoint URL', placeholder: 'http://localhost:1234/v1/chat/completions', type: 'text', provider: 'lm-studio' },
                { key: 'custom-openai-url', label: 'Custom OpenAI Endpoint URL', placeholder: 'http://my-endpoint/v1/chat/completions', type: 'text', provider: 'custom-openai' },
                { key: 'custom-openai-key', label: 'Custom OpenAI API Key', placeholder: 'key...', type: 'password', provider: null }
              ].filter((field) => matches(searchQuery, field.label)).map((field) => {
                const test = field.provider ? connectionTests[field.provider] : undefined;
                return (
                  <SettingRow key={field.key} title={field.label}>
                    <Input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={settings[field.key] || ''}
                      onChange={(e) => handleUpdateSetting(field.key, e.target.value)}
                    />
                    {field.provider && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={test?.status === 'testing'}
                          onClick={() => handleTestConnection(field.provider as string)}
                        >
                          {test?.status === 'testing' ? 'Testing…' : 'Test Connection'}
                        </Button>
                        {test?.status === 'testing' && (
                          <Loader2 size={14} className="sde-spin" style={{ color: 'var(--text-secondary)' }} />
                        )}
                        {test?.status === 'success' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-success)' }}>
                            <CheckCircle2 size={14} /> {test.message}
                          </span>
                        )}
                        {test?.status === 'error' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-danger)' }}>
                            <XCircle size={14} /> {test.message}
                          </span>
                        )}
                      </div>
                    )}
                  </SettingRow>
                );
              })}
            </div>
          )}

          {effectiveCategory === 'cloud-sync' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">Cloud Sync</h2>
              <SyncTab
                user={user}
                isAuthenticated={isAuthenticated}
                login={login}
                register={register}
                logout={logout}
                deleteAccount={deleteAccount}
                authError={authError}
                clearError={clearError}
                isSyncEnabled={isSyncEnabled}
                toggleSyncEnabled={toggleSyncEnabled}
                pushSettings={pushSettings}
                pullSettings={pullSettings}
                lastSyncedAt={lastSyncedAt}
                syncing={syncing}
                syncError={syncError}
                usernameInput={usernameInput}
                setUsernameInput={setUsernameInput}
                emailInput={emailInput}
                setEmailInput={setEmailInput}
                passwordInput={passwordInput}
                setPasswordInput={setPasswordInput}
                isRegisterMode={isRegisterMode}
                setIsRegisterMode={setIsRegisterMode}
                statusMsg={statusMsg}
                setStatusMsg={setStatusMsg}
              />
            </div>
          )}

          {effectiveCategory === 'mcp-servers' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">MCP Servers</h2>
              <McpServersTab />
            </div>
          )}

          {effectiveCategory === 'external-agents' && (
            <div className="sde-settings-category">
              <h2 className="sde-settings-category-title">External Agents</h2>
              <ExternalAgentsTab />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
