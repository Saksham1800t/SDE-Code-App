import React from 'react';
import { getPlaceholderIcon } from '../../../utils/extensionIcon';

interface ExtensionIconProps {
  seed: string;
  size?: number;
}

export const ExtensionIcon: React.FC<ExtensionIconProps> = ({ seed, size = 28 }) => {
  const { letter, color } = getPlaceholderIcon(seed);
  return (
    <div
      className="sde-ext-icon-tile"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `${color}26`,
        color,
        borderColor: `${color}55`,
      }}
    >
      {letter}
    </div>
  );
};
