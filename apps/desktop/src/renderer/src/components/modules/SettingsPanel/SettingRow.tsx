import React from 'react';
import './SettingsPanel.css';
import { SettingCheckbox } from './SettingCheckbox';

interface SettingRowProps {
  title: string;
  description?: string;
  /** Amber left-edge bar — value differs from its default. */
  modified?: boolean;
  /** Renders a checkbox to the left of the description, VS Code's real
   * boolean-setting layout — mutually exclusive with `children`. */
  boolean?: { checked: boolean; onChange: () => void; disabled?: boolean };
  /** For non-boolean settings: the control (Select/Input/etc), stacked
   * below the description, matching VS Code's real layout. */
  children?: React.ReactNode;
}

export const SettingRow: React.FC<SettingRowProps> = ({ title, description, modified, boolean, children }) => {
  return (
    <div className={`sde-setting-row${modified ? ' sde-setting-row--modified' : ''}`}>
      <div className="sde-setting-row-title">{title}</div>
      {boolean ? (
        <div className="sde-setting-row-bool-line">
          <SettingCheckbox checked={boolean.checked} onChange={boolean.onChange} disabled={boolean.disabled} />
          {description && (
            // Description toggles too; scoped to this span (not the wrapper) to avoid double-firing with the checkbox's onClick.
            <span
              className="sde-setting-row-description sde-setting-row-description--clickable"
              onClick={() => !boolean.disabled && boolean.onChange()}
            >
              {description}
            </span>
          )}
        </div>
      ) : (
        <>
          {description && <div className="sde-setting-row-description">{description}</div>}
          {children && <div className="sde-setting-row-control">{children}</div>}
        </>
      )}
    </div>
  );
};
