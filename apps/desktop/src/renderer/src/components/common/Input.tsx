import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './Input.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  focusAccent?: 'cyan' | 'purple';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  label,
  focusAccent = 'cyan',
  className = '',
  style,
  ...props
}, ref) => {
  // Applies to every type="password" input automatically, so any password
  // field gets a reveal toggle without each call site wiring its own.
  const isPassword = props.type === 'password';
  const [revealed, setRevealed] = useState(false);

  const inputClass = [
    'sde-input',
    `sde-input--focus-${focusAccent}`,
    isPassword ? 'sde-input--has-reveal' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className="sde-input-wrapper">
      {label && <label className="sde-input-label">{label}</label>}
      <div className={isPassword ? 'sde-input-reveal-wrapper' : undefined}>
        <input
          {...props}
          ref={ref}
          type={isPassword ? (revealed ? 'text' : 'password') : props.type}
          className={inputClass}
          style={style}
        />
        {isPassword && (
          <button
            type="button"
            className="sde-input-reveal-btn"
            tabIndex={-1}
            onClick={() => setRevealed((r) => !r)}
            title={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
});
Input.displayName = 'Input';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  focusAccent?: 'cyan' | 'purple';
}

export const TextArea: React.FC<TextAreaProps> = ({
  label,
  focusAccent = 'cyan',
  className = '',
  style,
  ...props
}) => {
  const textareaClass = [
    'sde-textarea',
    `sde-textarea--focus-${focusAccent}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className="sde-input-wrapper">
      {label && <label className="sde-input-label">{label}</label>}
      <textarea
        {...props}
        className={textareaClass}
        style={style}
      />
    </div>
  );
};
