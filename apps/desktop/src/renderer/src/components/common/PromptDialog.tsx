import React, { useEffect, useRef, useState } from 'react';
import { usePromptStore } from '../../store/prompt';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';

export const PromptDialog: React.FC = () => {
  const { currentPrompt, resolvePrompt } = usePromptStore();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentPrompt) {
      setValue(currentPrompt.defaultValue ?? '');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [currentPrompt]);

  if (!currentPrompt) return null;

  const { message, title, confirmLabel = 'OK', cancelLabel = 'Cancel', placeholder } = currentPrompt;

  const submit = () => resolvePrompt(value.trim() || null);

  return (
    <Modal isOpen={!!currentPrompt} onClose={() => resolvePrompt(null)} title={title ?? 'SDE Code'} width="420px">
      <div className="sde-flex-col" style={{ gap: '12px' }}>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: '1.5',
            margin: 0,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {message}
        </p>
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" onClick={() => resolvePrompt(null)}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
