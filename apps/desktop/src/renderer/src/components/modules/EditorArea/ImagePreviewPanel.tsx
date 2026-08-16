import React from 'react';
import './ImagePreviewPanel.css';
import { toFileUrl } from '../../../utils/fileUrl';

interface ImagePreviewPanelProps {
  filePath: string;
}

export const ImagePreviewPanel: React.FC<ImagePreviewPanelProps> = ({ filePath }) => {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return (
    <div className="sde-image-preview">
      <img src={toFileUrl(filePath)} alt={fileName} className="sde-image-preview-img" />
    </div>
  );
};
