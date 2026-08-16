import React from 'react';
import { useAlertStore } from '../../store/alerts';
import { Modal } from './Modal';
import { Button } from './Button';

export const AlertDialog: React.FC = () => {
  const { currentAlert, closeAlert } = useAlertStore();

  if (!currentAlert) return null;

  return (
    <Modal
      isOpen={!!currentAlert}
      onClose={closeAlert}
      title={currentAlert.title}
      width="380px"
    >
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
          {currentAlert.message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={closeAlert}>
            OK
          </Button>
        </div>
      </div>
    </Modal>
  );
};
