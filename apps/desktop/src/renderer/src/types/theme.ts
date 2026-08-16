export interface ThemeConfig {
  name: string;
  label: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  borderColor: string;
  accentColor: string;
  accentSecondary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Icon-theme override from an extension's `registerTheme` variables — see ThemeVariables.iconMap in @sde-code/sdk. */
  iconMap?: Record<string, string>;
}
