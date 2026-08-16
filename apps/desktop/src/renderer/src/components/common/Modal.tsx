import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  width?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  width = '420px',
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="sde-modal-overlay" onClick={onClose}>
      <div
        className="sde-modal-panel"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h4 className="sde-modal-title">{title}</h4>}
        {children}
      </div>
    </div>,
    document.body,
  );
};
