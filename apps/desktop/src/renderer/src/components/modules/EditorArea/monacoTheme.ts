import { useEffect } from 'react';
import { useThemeStore, getCustomThemes } from '../../../store/theme';
import { computeChromeBg, getThemeConfig, isDarkColor } from '../../../utils/theme';
import type { ThemeConfig } from '../../../types/theme';

/** Single theme name Monaco is ever told about — redefining it repaints every open editor/diff pane at once on app theme change. */
export const MONACO_THEME_NAME = 'sde-active';

function withAlpha(hex: string, alphaHex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alphaHex}` : hex;
}


export function buildMonacoThemeData(theme: ThemeConfig) {
  return {
    base: isDarkColor(theme.bgPrimary) ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': computeChromeBg(theme.bgPrimary),
      'diffEditor.insertedTextBackground': '#3fb95022',
      'diffEditor.removedTextBackground': '#f8514922',
      'diffEditor.insertedLineBackground': '#3fb95012',
      'diffEditor.removedLineBackground': '#f8514912',
      'diffEditor.border': withAlpha(theme.borderColor, '40'),
      'menu.background': theme.bgTertiary,
      'menu.foreground': theme.textPrimary,
      'menu.selectionBackground': withAlpha(theme.accentColor, '1f'),
      'menu.selectionForeground': theme.textPrimary,
      'menu.separatorBackground': withAlpha(theme.borderColor, '40'),
      'menu.border': withAlpha(theme.borderColor, '40'),
    },
  } as const;
}

/** Registers + applies the Monaco theme for the active app theme; idempotent, so safe to call from multiple editor instances. */
export function applyMonacoTheme(monaco: any): void {
  const theme = getThemeConfig(useThemeStore.getState().currentTheme, getCustomThemes());
  monaco.editor.defineTheme(MONACO_THEME_NAME, buildMonacoThemeData(theme));
}


export function useMonacoThemeSync(monaco: any): void {
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const localThemes = useThemeStore((s) => s.localThemes);
  const extensionThemes = useThemeStore((s) => s.extensionThemes);

  useEffect(() => {
    if (!monaco) return;
    const theme = getThemeConfig(currentTheme, getCustomThemes());
    monaco.editor.defineTheme(MONACO_THEME_NAME, buildMonacoThemeData(theme));
    monaco.editor.setTheme(MONACO_THEME_NAME);
  }, [monaco, currentTheme, localThemes, extensionThemes]);
}
