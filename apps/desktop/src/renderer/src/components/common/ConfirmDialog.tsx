import React from 'react';
import { useConfirmStore } from '../../store/confirm';
import { Modal } from './Modal';
import { Button } from './Button';

export const ConfirmDialog: React.FC = () => {
  const { currentConfirm, resolveConfirm } = useConfirmStore();

  if (!currentConfirm) return null;

  const { message, title, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger } = currentConfirm;

  return (
    <Modal isOpen={!!currentConfirm} onClose={() => resolveConfirm(false)} title={title ?? 'SDE Code'} width="420px">
      <div className="sde-flex-col" style={{ gap: '20px' }}>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: '1.5',
            margin: 0,
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" onClick={() => resolveConfirm(false)}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => resolveConfirm(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
