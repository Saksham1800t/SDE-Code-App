import React from 'react';
import { Modal } from '../../common/Modal';

interface TerminalHistoryPickerProps {
  title: string;
  items: string[];
  onSelect: (item: string) => void;
  onClose: () => void;
}

export const TerminalHistoryPicker: React.FC<TerminalHistoryPickerProps> = ({ title, items, onSelect, onClose }) => (
  <Modal isOpen onClose={onClose} title={title} width="420px">
    <div className="sde-terminal-history-list">
      {items.map((item, i) => (
        <button key={`${item}-${i}`} className="sde-terminal-history-item" onClick={() => { onSelect(item); onClose(); }}>
          {item}
        </button>
      ))}
    </div>
  </Modal>
);
