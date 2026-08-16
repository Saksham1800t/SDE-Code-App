import React from 'react';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  options?: SelectOption[];
  size?: 'sm' | 'md';
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  children,
  size = 'md',
  className = '',
  style,
  ...props
}) => {
  const selectClass = [
    'sde-select',
    `sde-select--${size}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className="sde-select-wrapper">
      {label && <label className="sde-select-label">{label}</label>}
      <select
        {...props}
        className={selectClass}
        style={style}
      >
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    </div>
  );
};
