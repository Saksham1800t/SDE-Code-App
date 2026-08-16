import React from 'react';
import { X } from 'lucide-react';
import './SettingsPanel.css';

interface SettingsSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export const SettingsSearchBar: React.FC<SettingsSearchBarProps> = ({ value, onChange }) => {
  return (
    <div className="sde-settings-search-bar">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search settings"
        className="sde-settings-search-input"
      />
      {value && (
        <button
          className="sde-settings-search-clear"
          title="Clear Settings Search Input"
          onClick={() => onChange('')}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};
