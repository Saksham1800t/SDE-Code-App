import React from 'react';
import { Check } from 'lucide-react';
import './SettingsPanel.css';

interface SettingCheckboxProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

/** Square checkbox for boolean settings; kept separate from the pill-style common/Switch.tsx used elsewhere. */
export const SettingCheckbox: React.FC<SettingCheckboxProps> = ({ checked, onChange, disabled = false }) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`sde-setting-checkbox${checked ? ' sde-setting-checkbox--checked' : ''}`}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  );
};
