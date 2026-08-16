import React from 'react';
import './VideoPreviewPanel.css';
import { toFileUrl } from '../../../utils/fileUrl';

interface VideoPreviewPanelProps {
  filePath: string;
}

export const VideoPreviewPanel: React.FC<VideoPreviewPanelProps> = ({ filePath }) => {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return (
    <div className="sde-video-preview">
      <video controls src={toFileUrl(filePath)} className="sde-video-preview-player" aria-label={fileName} />
    </div>
  );
};
