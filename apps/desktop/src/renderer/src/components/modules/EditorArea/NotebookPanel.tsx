import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Play, Square, RotateCcw, Plus, Trash2, ChevronUp, ChevronDown, Repeat, Type } from 'lucide-react';
import { useNotebookStore, type NotebookTabKernelStatus } from '../../../store/notebook';
import { useWorkspaceStore } from '../../../store/workspace';
import { serializeNotebook, type NotebookCell, type NotebookCellType } from '../../../utils/notebookFormat';
import { MONACO_THEME_NAME, applyMonacoTheme } from './monacoTheme';
import './NotebookPanel.css';

interface NotebookPanelProps {
  filePath: string;
}

const LANGUAGE_TO_MONACO_ID: Record<string, string> = { python: 'python', javascript: 'javascript', typescript: 'typescript' };

const KERNEL_STATUS_LABEL: Record<NotebookTabKernelStatus, string> = {
  stopped: 'No Kernel',
  starting: 'Starting…',
  idle: 'Idle',
  busy: 'Busy',
  dead: 'Kernel Died',
};

/** Cell list for a .ipynb tab — a persistent per-language kernel process backs execution (see notebookKernelService.ts). This panel owns pushing its serialized document back into the workspace tab's content (setTabContent), the same convention SearchEditorPanel uses, so the existing Ctrl+S/dirty/close-confirmation pipeline needs no notebook-specific code. */
export const NotebookPanel: React.FC<NotebookPanelProps> = ({ filePath }) => {
  const tab = useNotebookStore((s) => s.tabs[filePath]);
  const workspaceTabContent = useWorkspaceStore((s) => s.groups.flatMap((g) => g.tabs).find((t) => t.path === filePath)?.content);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (tab || workspaceTabContent === undefined) return;
    useNotebookStore.getState().openNotebook(filePath, workspaceTabContent);
  }, [filePath, tab, workspaceTabContent]);

  useEffect(() => {
    if (!tab) return;
    const serialized = serializeNotebook(tab.document);
    if (serialized === lastSyncedRef.current) return;
    lastSyncedRef.current = serialized;
    useWorkspaceStore.getState().setTabContent(filePath, serialized, true);
  }, [tab, filePath]);

  if (!tab) return <div className="sde-notebook-panel sde-notebook-panel--loading">Loading notebook…</div>;

  const { document, kernelStatus, runningCellId } = tab;

  const runAll = async () => {
    for (const cell of useNotebookStore.getState().tabs[filePath]?.document.cells ?? []) {
      if (cell.cellType === 'code') await useNotebookStore.getState().runCell(filePath, cell.id);
    }
  };

  return (
    <div className="sde-notebook-panel">
      <div className="sde-notebook-toolbar">
        <button className="sde-icon-btn" title="Run All Cells" disabled={kernelStatus === 'busy'} onClick={runAll}>
          <Play size={14} />
        </button>
        <button className="sde-icon-btn" title="Interrupt Kernel" disabled={kernelStatus !== 'busy'} onClick={() => useNotebookStore.getState().interruptKernel(filePath)}>
          <Square size={14} />
        </button>
        <button className="sde-icon-btn" title="Restart Kernel" disabled={kernelStatus === 'stopped'} onClick={() => useNotebookStore.getState().restartKernel(filePath)}>
          <RotateCcw size={14} />
        </button>
        <span className={`sde-notebook-kernel-status sde-notebook-kernel-status--${kernelStatus}`}>
          {kernelStatus === 'busy' && <span className="sde-spinner" />}
          {KERNEL_STATUS_LABEL[kernelStatus]}
        </span>
      </div>

      <div className="sde-notebook-cells">
        {document.cells.length === 0 && (
          <div className="sde-notebook-empty">
            <p>This notebook has no cells yet.</p>
            <button className="sde-btn sde-btn--secondary sde-btn--sm" onClick={() => useNotebookStore.getState().addCell(filePath, null, 'code')}>
              <Plus size={13} /> Add a code cell
            </button>
          </div>
        )}
        {document.cells.map((cell, idx) => (
          <NotebookCellView
            key={cell.id}
            filePath={filePath}
            cell={cell}
            isFirst={idx === 0}
            isLast={idx === document.cells.length - 1}
            isRunning={runningCellId === cell.id}
            language={document.language}
          />
        ))}
      </div>
    </div>
  );
};

interface NotebookCellViewProps {
  filePath: string;
  cell: NotebookCell;
  isFirst: boolean;
  isLast: boolean;
  isRunning: boolean;
  language: string;
}

const NotebookCellView: React.FC<NotebookCellViewProps> = ({ filePath, cell, isFirst, isLast, isRunning, language }) => {
  const [editingMarkdown, setEditingMarkdown] = useState(cell.cellType === 'markdown' && cell.source === '');
  const [editorHeight, setEditorHeight] = useState(() => Math.max(19, cell.source.split('\n').length * 19 + 12));

  const html = useMemo(() => {
    if (cell.cellType !== 'markdown') return '';
    try {
      return DOMPurify.sanitize(marked(cell.source || '*Empty markdown cell*', { async: false }));
    } catch (err) {
      console.error('Failed to render notebook markdown cell:', err);
      return '<p>Failed to render markdown.</p>';
    }
  }, [cell.cellType, cell.source]);

  const monacoLanguage = LANGUAGE_TO_MONACO_ID[language] ?? 'python';

  const setCellType = (cellType: NotebookCellType) => useNotebookStore.getState().setCellType(filePath, cell.id, cellType);

  return (
    <div className={`sde-notebook-cell sde-notebook-cell--${cell.cellType}${isRunning ? ' sde-notebook-cell--running' : ''}`}>
      <div className="sde-notebook-cell-gutter">
        {cell.cellType === 'code' ? (
          <button className="sde-icon-btn" title="Run Cell" disabled={isRunning} onClick={() => useNotebookStore.getState().runCell(filePath, cell.id)}>
            {isRunning ? <span className="sde-spinner" /> : <Play size={13} />}
          </button>
        ) : (
          <span className="sde-notebook-cell-type-icon" title="Markdown cell">
            <Type size={13} />
          </span>
        )}
        {cell.cellType === 'code' && <span className="sde-notebook-exec-count">[{cell.executionCount ?? ' '}]</span>}
      </div>

      <div className="sde-notebook-cell-body">
        {cell.cellType === 'code' ? (
          <Editor
            height={editorHeight}
            theme={MONACO_THEME_NAME}
            beforeMount={(m) => applyMonacoTheme(m)}
            language={monacoLanguage}
            defaultValue={cell.source}
            onMount={(editor: monaco.editor.IStandaloneCodeEditor) => {
              const updateHeight = () => setEditorHeight(Math.max(19, editor.getContentHeight()));
              updateHeight();
              editor.onDidContentSizeChange(updateHeight);
            }}
            onChange={(value) => useNotebookStore.getState().updateCellSource(filePath, cell.id, value ?? '')}
            options={{
              minimap: { enabled: false },
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              scrollBeyondLastLine: false,
              lineNumbers: 'off',
              glyphMargin: false,
              folding: false,
              overviewRulerLanes: 0,
              scrollbar: { vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false },
              padding: { top: 6, bottom: 6 },
            }}
          />
        ) : editingMarkdown ? (
          <textarea
            className="sde-notebook-markdown-editor"
            value={cell.source}
            autoFocus
            placeholder="Markdown…"
            onChange={(e) => useNotebookStore.getState().updateCellSource(filePath, cell.id, e.target.value)}
            onBlur={() => setEditingMarkdown(false)}
          />
        ) : (
          <div className="sde-notebook-markdown-preview" title="Double-click to edit" onDoubleClick={() => setEditingMarkdown(true)} dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {cell.cellType === 'code' && cell.outputs.length > 0 && (
          <div className="sde-notebook-cell-outputs">
            {cell.outputs.map((output, i) => (
              <pre key={i} className={`sde-notebook-output sde-notebook-output--${output.type}${output.name === 'stderr' ? ' sde-notebook-output--stderr' : ''}`}>
                {output.text}
              </pre>
            ))}
          </div>
        )}
      </div>

      <div className="sde-notebook-cell-actions">
        <button className="sde-icon-btn" title="Move Up" disabled={isFirst} onClick={() => useNotebookStore.getState().moveCell(filePath, cell.id, 'up')}>
          <ChevronUp size={13} />
        </button>
        <button className="sde-icon-btn" title="Move Down" disabled={isLast} onClick={() => useNotebookStore.getState().moveCell(filePath, cell.id, 'down')}>
          <ChevronDown size={13} />
        </button>
        <button className="sde-icon-btn" title="Insert Cell Below" onClick={() => useNotebookStore.getState().addCell(filePath, cell.id, 'code')}>
          <Plus size={13} />
        </button>
        <button
          className="sde-icon-btn"
          title={cell.cellType === 'code' ? 'Convert to Markdown' : 'Convert to Code'}
          onClick={() => setCellType(cell.cellType === 'code' ? 'markdown' : 'code')}
        >
          <Repeat size={13} />
        </button>
        <button className="sde-icon-btn sde-icon-btn--danger" title="Delete Cell" onClick={() => useNotebookStore.getState().deleteCell(filePath, cell.id)}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
};
