import React from 'react';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
}) => {
  const switchClass = [
    'sde-switch',
    `sde-switch--${size}`,
    checked ? 'sde-switch--checked' : 'sde-switch--unchecked',
    disabled ? 'sde-switch--disabled' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={switchClass}
      style={{
        justifyContent: checked ? 'flex-end' : 'flex-start',
      }}
    >
      <div className={`sde-switch-knob sde-switch-knob--${size}`} />
    </div>
  );
};
