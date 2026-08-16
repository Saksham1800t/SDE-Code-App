import { create } from 'zustand';
import { applyThemeVariables } from '../utils/theme';
import { ThemeConfig } from '../types/theme';
import { useStatusBarStore } from './statusBar';
import { useExtensionsStore } from './extensions';
import { useAgentStore } from './agent';
import { getProviderLabel } from '../utils/aiModels';
import { authenticatedFetch } from './auth';
import { resolveServerBaseUrl } from '../../../shared/serverConfig';

export const getCustomThemes = (): Record<string, ThemeConfig> => {
  const customThemes: Record<string, ThemeConfig> = {};

  // Merge SQLite database themes (default and synced themes)
  try {
    const localThemes = useThemeStore.getState().localThemes || {};
    Object.assign(customThemes, localThemes);
  } catch (e) {
    // Ignore if store is not initialized yet
  }

  // Themes contributed by real, activated extensions — fetched once via loadExtensionThemes() and cached here so this function can stay synchronous.
  try {
    const extensionThemes = useThemeStore.getState().extensionThemes || {};
    Object.assign(customThemes, extensionThemes);
  } catch (e) {
    // Ignore if store is not initialized yet
  }

  return customThemes;
};

interface ThemeState {
  currentTheme: string;
  localThemes: Record<string, ThemeConfig>;
  extensionThemes: Record<string, ThemeConfig>;
  setTheme: (theme: string) => void;
  initializeTheme: () => Promise<void>;
  loadServerThemes: () => Promise<void>;
  loadLocalThemes: () => Promise<void>;
  loadExtensionThemes: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentTheme: 'slate',
  localThemes: {},
  extensionThemes: {},

  setTheme: (themeName) => {
    set({ currentTheme: themeName });
    const customThemes = getCustomThemes();
    applyThemeVariables(themeName, customThemes);

    const api = window.api;
    if (api && api.setSetting) {
      api.setSetting('ide-theme', themeName);
    }
  },

  loadLocalThemes: async () => {
    const api = window.api;
    if (api && api.getThemes) {
      try {
        const list = await api.getThemes();
        const themesMap: Record<string, ThemeConfig> = {};
        list.forEach((t: any) => {
          themesMap[t.id] = {
            name: t.id,
            label: t.label || t.name,
            bgPrimary: t.bg_primary,
            bgSecondary: t.bg_secondary,
            bgTertiary: t.bg_tertiary,
            borderColor: t.border_color,
            accentColor: t.accent_color,
            accentSecondary: t.accent_secondary,
            textPrimary: t.text_primary,
            textSecondary: t.text_secondary,
            textMuted: t.text_muted
          };
        });
        set({ localThemes: themesMap });
      } catch (e) {
        console.error('Failed to load local SQLite themes:', e);
      }
    }
  },

  loadExtensionThemes: async () => {
    const api = window.api;
    if (api && api.getExtensionThemes) {
      try {
        const list = await api.getExtensionThemes();
        const themesMap: Record<string, ThemeConfig> = {};
        list.forEach((t) => {
          const v = t.variables;
          const str = (key: string): string | undefined => (typeof v[key] === 'string' ? (v[key] as string) : undefined);
          themesMap[t.id] = {
            name: t.id,
            label: t.id,
            bgPrimary: str('bgPrimary') || '#0d1117',
            bgSecondary: str('bgSecondary') || '#161b22',
            bgTertiary: str('bgTertiary') || str('bgSecondary') || '#21262d',
            borderColor: str('borderColor') || '#30363d',
            accentColor: str('accentCyan') || '#58a6ff',
            accentSecondary: str('accentCyanGlow') || str('accentGlow') || 'rgba(88, 166, 255, 0.25)',
            textPrimary: str('textPrimary') || '#c9d1d9',
            textSecondary: str('textSecondary') || '#8b949e',
            textMuted: str('textMuted') || str('textSecondary') || '#484f58',
            iconMap: typeof v.iconMap === 'object' ? v.iconMap : undefined,
          };
        });
        set({ extensionThemes: themesMap });
      } catch (e) {
        console.error('Failed to load extension themes:', e);
      }
    }
  },

  loadServerThemes: async () => {
    try {
      const res = await authenticatedFetch(`${resolveServerBaseUrl(import.meta.env.VITE_SERVER_URL)}/api/themes`);
      if (res.ok) {
        const list = await res.json();
        const api = window.api;
        if (api && api.saveTheme) {
          for (const t of list) {
            await api.saveTheme({
              id: t.id,
              name: t.id,
              label: t.label,
              bgPrimary: t.bgPrimary,
              bgSecondary: t.bgSecondary,
              bgTertiary: t.bgTertiary,
              borderColor: t.borderColor,
              accentColor: t.accentColor,
              accentSecondary: t.accentSecondary,
              textPrimary: t.textPrimary,
              textSecondary: t.textSecondary,
              textMuted: t.textMuted,
              isDefault: true
            });
          }
          await get().loadLocalThemes();
        }
      }
    } catch (e) {
      console.error('Failed to load server themes:', e);
    }
  },

  initializeTheme: async () => {
    // 1. Initialize extensions store first so local theme extensions are loaded
    await useExtensionsStore.getState().initialize();

    // 2. Load local (SQLite) and extension-contributed themes — extensions have already activated (main fires onStartupFinished before window creation).
    await get().loadLocalThemes();
    await get().loadExtensionThemes();

    // 3. Load settings and apply saved theme immediately (so visual load is fast)
    const api = window.api;
    if (api) {
      try {
        const settings = await api.getSettings();
        const savedTheme = (settings && settings['ide-theme']) || 'slate';
        set({ currentTheme: savedTheme });
        const customThemes = getCustomThemes();
        applyThemeVariables(savedTheme, customThemes);

        const savedProvider = (settings && settings['ide-ai-provider']) || 'gemini';
        const savedModel = (settings && settings['ide-ai-model']) || 'gemini-1.5-flash';
        const savedInlineCompletionFlag = settings && settings['ide-inline-completion-enabled'];
        // Raw .setState() rather than setActiveAIProvider(), which would redundantly re-persist a value we just read from settings.
        useAgentStore.setState({
          activeAIProvider: savedProvider,
          activeAIModel: savedModel,
          inlineCompletionEnabled: savedInlineCompletionFlag !== '0',
        });

        useStatusBarStore.getState().updateItemText('ai-provider', getProviderLabel(savedProvider));
      } catch (err) {
        console.error('Failed to initialize settings:', err);
        applyThemeVariables('slate');
      }
    } else {
      applyThemeVariables('slate');
    }

    // 4. Load/sync server themes in background, writing to SQLite and re-applying if currentTheme changed or is custom
    await get().loadServerThemes();
    if (api) {
      try {
        const settings = await api.getSettings();
        const savedTheme = (settings && settings['ide-theme']) || 'slate';
        const customThemes = getCustomThemes();
        applyThemeVariables(savedTheme, customThemes);
      } catch (e) {
        console.error('Failed to re-apply theme after server sync:', e);
      }
    }
  },
}));
