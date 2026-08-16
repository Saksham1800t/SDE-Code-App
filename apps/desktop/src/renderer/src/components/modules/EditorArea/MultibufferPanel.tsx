import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import './MultibufferPanel.css';
import { MONACO_THEME_NAME, applyMonacoTheme } from './monacoTheme';
import { useMultibufferStore } from '../../../store/multibuffer';
import {
  buildMultibufferDocument,
  groupExcerptEditsByFile,
  applyWriteBackToFileContent,
  type MultibufferExcerptRange,
} from '../../../utils/multibuffer';
import { Save } from 'lucide-react';

interface MultibufferPanelProps {
  tabPath: string;
}

/**
 * Renders a synthetic, editable document assembled from excerpts of several
 * real files (see utils/multibuffer.ts for the write-back model this
 * depends on). Decoration ids — not the build-time line numbers — are the
 * source of truth for each excerpt's current range once the user starts
 * editing, since Monaco's TrackedRangeStickiness keeps them accurate across
 * inserts/deletes anywhere else in the document.
 */
export const MultibufferPanel: React.FC<MultibufferPanelProps> = ({ tabPath }) => {
  const [initialText, setInitialText] = useState<string | null>(null);
  const [initialLanguagePath, setInitialLanguagePath] = useState<string>('multibuffer.txt');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessAt, setSaveSuccessAt] = useState<number | null>(null);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const excerptsRef = useRef<MultibufferExcerptRange[]>([]);
  const decorationIdsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const sources = useMultibufferStore.getState().getExcerptSources(tabPath);
    const api = window.api;
    if (!api || sources.length === 0) {
      setInitialText('');
      return;
    }

    (async () => {
      const uniquePaths = Array.from(new Set(sources.map((s) => s.filePath)));
      const fileContents = new Map<string, string>();
      await Promise.all(
        uniquePaths.map(async (p) => {
          try {
            fileContents.set(p, await api.readFile(p));
          } catch (err) {
            console.error(`Multibuffer: failed to read ${p}:`, err);
            fileContents.set(p, '');
          }
        }),
      );
      if (cancelled) return;

      const doc = buildMultibufferDocument(sources, fileContents);
      excerptsRef.current = doc.excerpts;
      setInitialLanguagePath(sources[0].relativePath);
      setInitialText(doc.text);
    })();

    return () => {
      cancelled = true;
    };
  }, [tabPath]);

  const applyDecorations = (editor: monaco.editor.IStandaloneCodeEditor) => {
    const model = editor.getModel();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const excerpt of excerptsRef.current) {
      decorations.push({
        range: new monaco.Range(excerpt.headerLine, 1, excerpt.headerLine, 1),
        options: { isWholeLine: true, className: 'sde-multibuffer-header-line', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      });
      // endColumn must be the real end-of-line column (not 1) — getValueInRange at save
      // time reads exactly up to this column, so a decoration that stops at column 1
      // silently drops the entire last line's text from the write-back.
      const endColumn = model ? model.getLineMaxColumn(excerpt.docEndLine) : 1;
      decorations.push({
        range: new monaco.Range(excerpt.docStartLine, 1, excerpt.docEndLine, endColumn),
        options: { isWholeLine: true, className: 'sde-multibuffer-excerpt-line', stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges },
      });
    }
    // Header decorations interleave with excerpt decorations at 2n / 2n+1 — kept in that order so indices below line up.
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
  };

  useEffect(() => {
    if (initialText !== null && editorRef.current) applyDecorations(editorRef.current);
  }, [initialText]);

  const handleSaveAll = async () => {
    const editor = editorRef.current;
    const api = window.api;
    const model = editor?.getModel();
    if (!editor || !api || !model) return;

    setSaving(true);
    setSaveError(null);
    try {
      const excerptsWithContent = excerptsRef.current.map((excerpt, i) => {
        // Excerpt content decorations sit at odd indices (header, content, header, content, ...).
        const decorationId = decorationIdsRef.current[i * 2 + 1];
        const liveRange = decorationId ? model.getDecorationRange(decorationId) : null;
        const currentLines = liveRange ? model.getValueInRange(liveRange).split(/\r\n|\n/) : [];
        return { source: excerpt.source, currentLines };
      });

      const writeBacks = groupExcerptEditsByFile(excerptsWithContent);
      for (const writeBack of writeBacks) {
        const currentContent = await api.readFile(writeBack.filePath);
        const newContent = applyWriteBackToFileContent(currentContent, writeBack.edits);
        await api.writeFile(writeBack.filePath, newContent);
      }
      setSaveSuccessAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save multibuffer changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sde-multibuffer-panel">
      <div className="sde-multibuffer-toolbar">
        <button className="sde-btn sde-btn--primary sde-btn--sm" onClick={handleSaveAll} disabled={saving || initialText === null}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save All'}
        </button>
        {saveError && <span className="sde-multibuffer-status sde-multibuffer-status--error">{saveError}</span>}
        {!saveError && saveSuccessAt && <span className="sde-multibuffer-status sde-multibuffer-status--success">Saved</span>}
      </div>
      <div className="sde-multibuffer-editor">
        {initialText !== null && (
          <Editor
            height="100%"
            theme={MONACO_THEME_NAME}
            beforeMount={(m) => applyMonacoTheme(m)}
            path={initialLanguagePath}
            defaultValue={initialText}
            onMount={(editor) => {
              editorRef.current = editor;
              applyDecorations(editor);
            }}
            options={{
              minimap: { enabled: false },
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              scrollBeyondLastLine: false,
              padding: { top: 8 },
            }}
          />
        )}
      </div>
    </div>
  );
};
