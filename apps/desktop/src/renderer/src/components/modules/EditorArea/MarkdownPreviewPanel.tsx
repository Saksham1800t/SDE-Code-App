import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './MarkdownPreviewPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';

interface MarkdownPreviewPanelProps {
  sourceFilePath: string;
}


export const MarkdownPreviewPanel: React.FC<MarkdownPreviewPanelProps> = ({ sourceFilePath }) => {
  const sourceContent = useWorkspaceStore(
    (s) => s.groups.flatMap((g) => g.tabs).find((t) => t.path === sourceFilePath)?.content ?? '',
  );

  const html = useMemo(() => {
    try {
      // marked() doesn't strip raw HTML in the source, so sanitize with DOMPurify before dangerouslySetInnerHTML to avoid XSS.
      return DOMPurify.sanitize(marked(sourceContent, { async: false }));
    } catch (err) {
      console.error('Failed to render markdown preview:', err);
      return '<p>Failed to render preview.</p>';
    }
  }, [sourceContent]);

  return (
    <div className="sde-markdown-preview">
      <div className="sde-markdown-preview-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};
