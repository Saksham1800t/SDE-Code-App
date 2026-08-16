import * as monaco from 'monaco-editor';
import { useDebugStore } from '../store/debug';

/**
 * Wires the glyph margin as a breakpoint gutter for one editor instance:
 * click to toggle, red dot decoration for each breakpoint, a highlighted
 * line + arrow glyph for the current execution line while paused. Derives
 * the active file from `editor.getModel()` at call time rather than a
 * closed-over path — `<Editor>` persists one instance across tab switches
 * within a group (see keepCurrentModel's own comment), so onMount only
 * fires once and any path captured there would go stale after the first
 * tab switch.
 */
export function attachBreakpointGutter(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  let decorationIds: string[] = [];

  function currentFilePath(): string | null {
    return editor.getModel()?.uri.toString(true) ?? null;
  }

  function render(): void {
    const filePath = currentFilePath();
    if (!filePath) {
      decorationIds = editor.deltaDecorations(decorationIds, []);
      return;
    }

    const state = useDebugStore.getState();
    const decorations: monaco.editor.IModelDeltaDecoration[] = (state.breakpoints[filePath] ?? []).map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: false, glyphMarginClassName: 'sde-debug-breakpoint-glyph', stickiness: 1 },
    }));

    const activeSession = state.activeSessionId ? state.sessions[state.activeSessionId] : undefined;
    if (activeSession?.status === 'paused') {
      const topFrame = activeSession.callStack[0];
      const frameFile = (topFrame?.source?.path ?? activeSession.filePath).replace(/\\/g, '/').toLowerCase();
      if (topFrame && frameFile === filePath.replace(/\\/g, '/').toLowerCase()) {
        decorations.push({
          range: new monaco.Range(topFrame.line, 1, topFrame.line, 1),
          options: { isWholeLine: true, className: 'sde-debug-current-line', glyphMarginClassName: 'sde-debug-current-line-glyph', stickiness: 1 },
        });
      }
    }

    decorationIds = editor.deltaDecorations(decorationIds, decorations);
  }

  const clickListener = editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = e.target.position?.lineNumber;
    const filePath = currentFilePath();
    if (line && filePath) useDebugStore.getState().toggleBreakpoint(filePath, line);
  });

  const modelChangeListener = editor.onDidChangeModel(() => render());
  const unsubscribeStore = useDebugStore.subscribe(render);
  render();

  return () => {
    clickListener.dispose();
    modelChangeListener.dispose();
    unsubscribeStore();
  };
}
