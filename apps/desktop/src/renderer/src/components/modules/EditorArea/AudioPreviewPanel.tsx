import React from 'react';
import './AudioPreviewPanel.css';
import { toFileUrl } from '../../../utils/fileUrl';

interface AudioPreviewPanelProps {
  filePath: string;
}

export const AudioPreviewPanel: React.FC<AudioPreviewPanelProps> = ({ filePath }) => {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return (
    <div className="sde-audio-preview">
      <div className="sde-audio-preview-name">{fileName}</div>
      <audio controls src={toFileUrl(filePath)} className="sde-audio-preview-player" />
    </div>
  );
};
