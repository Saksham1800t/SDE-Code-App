import React from 'react';
import './AlertBanner.css';
import { AlertTriangle, Sparkles, X } from 'lucide-react';

export interface AlertBannerProps {
  type: 'error' | 'success';
  message: string;
  onClose?: () => void;
  style?: React.CSSProperties;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  type,
  message,
  onClose,
  style,
}) => {
  const isError = type === 'error';

  return (
    <div
      className={`sde-alert-banner sde-alert-banner--${type}`}
      style={style}
    >
      <span className="sde-alert-banner-text">
        {isError ? <AlertTriangle size={14} /> : <Sparkles size={14} />} {message}
      </span>
      {onClose && (
        <button
          onClick={onClose}
          className="sde-alert-banner-close"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};
