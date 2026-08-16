import React from 'react';
import { useUnsavedChangesStore } from '../../store/unsavedChanges';
import { Modal } from './Modal';
import { Button } from './Button';

export const UnsavedChangesDialog: React.FC = () => {
  const { currentRequest, resolveUnsavedChangesPrompt } = useUnsavedChangesStore();

  if (!currentRequest) return null;

  return (
    <Modal isOpen={!!currentRequest} onClose={() => resolveUnsavedChangesPrompt('cancel')} title="SDE Code" width="440px">
      <div className="sde-flex-col" style={{ gap: '20px' }}>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: '1.5',
            margin: 0,
            fontFamily: 'var(--font-sans)',
          }}
        >
          Do you want to save the changes you made to <strong>{currentRequest.fileName}</strong>?
          <br />
          Your changes will be lost if you don't save them.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" onClick={() => resolveUnsavedChangesPrompt('discard')}>
            Don't Save
          </Button>
          <Button variant="secondary" onClick={() => resolveUnsavedChangesPrompt('cancel')}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => resolveUnsavedChangesPrompt('save')}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};
