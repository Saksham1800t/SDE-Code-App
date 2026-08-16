import React from 'react';
import './Button.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'purple';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  style,
  ...props
}) => {
  const classes = [
    'sde-btn',
    `sde-btn--${variant}`,
    `sde-btn--${size}`,
    fullWidth ? 'sde-btn--fullwidth' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      className={classes}
      style={style}
    >
      {children}
    </button>
  );
};
