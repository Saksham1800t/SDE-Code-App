import React from 'react';
import { Keyboard } from 'lucide-react';
import './SettingsPanel.css';

export interface SettingsCategory {
  id: string;
  label: string;
}

interface SettingsTOCProps {
  categories: SettingsCategory[];
  activeCategory: string;
  onSelect: (id: string) => void;
  /** Keyboard Shortcuts is a separate editor tab, so this navigates away instead of swapping categories like onSelect. */
  onOpenShortcuts?: () => void;
}

export const SettingsTOC: React.FC<SettingsTOCProps> = ({ categories, activeCategory, onSelect, onOpenShortcuts }) => {
  return (
    <div className="sde-settings-toc">
      {categories.map((cat) => (
        <button
          key={cat.id}
          className={`sde-settings-toc-item${activeCategory === cat.id ? ' active' : ''}`}
          onClick={() => onSelect(cat.id)}
        >
          {cat.label}
        </button>
      ))}
      {onOpenShortcuts && (
        <>
          <div className="sde-settings-toc-divider" />
          <button className="sde-settings-toc-item sde-settings-toc-item--nav" onClick={onOpenShortcuts}>
            <Keyboard size={14} />
            Keyboard Shortcuts
          </button>
        </>
      )}
    </div>
  );
};
