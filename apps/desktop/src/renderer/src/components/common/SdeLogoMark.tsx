import React from 'react';
import { useThemeStore, getCustomThemes } from '../../store/theme';
import { getThemeConfig, computeChromeBg, isDarkColor } from '../../utils/theme';

interface SdeLogoMarkProps {
  size?: number;
  className?: string;
}

export const SdeLogoMark: React.FC<SdeLogoMarkProps> = ({ size = 20, className }) => {
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const theme = getThemeConfig(currentTheme, getCustomThemes());
  const chromeBg = computeChromeBg(theme.bgPrimary);
  const src = isDarkColor(chromeBg) ? './sde-mark.png' : './sde-mark-dark.png';

  return <img src={src} width={size} height={size} alt="" className={className} style={{ objectFit: 'contain' }} />;
};
