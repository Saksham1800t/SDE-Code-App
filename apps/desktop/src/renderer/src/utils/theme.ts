import { ThemeConfig } from '../types/theme';


const slateFallback: ThemeConfig = {
  name: 'slate',
  label: 'Midnight Slate (Default)',
  bgPrimary: '#0f172a',      // Slate 900
  bgSecondary: '#1e293b',    // Slate 800
  bgTertiary: '#334155',     // Slate 700
  borderColor: '#475569',    // Slate 600
  accentColor: '#38bdf8',    // Sky 400 (Solid Blue)
  accentSecondary: '#34d399',// Emerald 400 (Solid Green)
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b'
};

/** Mirrors index.css's --bg-chrome: color-mix(in srgb, var(--bg-primary) 90%, black 10%) — computed in JS because Electron's native titleBarOverlay can't consume a CSS custom property. */
export function computeChromeBg(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => Math.round(parseInt(h, 16) * 0.9));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Same "isDarker → white symbols, else black" rule VS Code's own titlebar-overlay logic uses. */
export function isDarkColor(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/** Same theme-lookup-with-fallback logic applyThemeVariables uses, exposed so other consumers (Monaco's theme, in particular) resolve the active theme's actual colors the same way the rest of the app does. */
export function getThemeConfig(themeName: string, customThemes?: Record<string, ThemeConfig>): ThemeConfig {
  return (customThemes && customThemes[themeName]) || slateFallback;
}

export const applyThemeVariables = (themeName: string, customThemes?: Record<string, ThemeConfig>) => {
  const theme = getThemeConfig(themeName, customThemes);
  const root = document.documentElement;

  root.style.setProperty('--bg-primary', theme.bgPrimary);
  root.style.setProperty('--bg-secondary', theme.bgSecondary);
  root.style.setProperty('--bg-tertiary', theme.bgTertiary);
  root.style.setProperty('--border-color', theme.borderColor);
  root.style.setProperty('--accent-cyan', theme.accentColor);
  root.style.setProperty('--accent-purple', theme.accentSecondary);
  root.style.setProperty('--text-primary', theme.textPrimary);
  root.style.setProperty('--text-secondary', theme.textSecondary);
  root.style.setProperty('--text-muted', theme.textMuted);

  // Set borders/shadows to solid without glowing gradients
  root.style.setProperty('--border-glow', 'transparent');
  root.style.setProperty('--accent-cyan-glow', 'none');
  root.style.setProperty('--accent-purple-glow', 'none');

  // Keep the native title-bar-overlay buttons in sync, or switching to a light theme leaves them stuck with near-invisible light-on-light symbols.
  const api = window.api;
  if (api?.setTitleBarOverlay) {
    const chromeBg = computeChromeBg(theme.bgPrimary);
    api.setTitleBarOverlay({
      color: chromeBg,
      symbolColor: isDarkColor(chromeBg) ? '#f1f5f9' : '#0d0f14',
    });
  }
};
