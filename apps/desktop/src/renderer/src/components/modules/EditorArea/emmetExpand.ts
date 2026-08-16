import expand, { extract } from 'emmet';
import type { UserConfig } from 'emmet';

/** Emmet config per eligible language id; JSX is language-scoped (any JS/TS file) since Monaco reports .tsx as plain 'typescript'. */
const LANGUAGE_CONFIG: Record<string, UserConfig> = {
  html: { type: 'markup', syntax: 'html' },
  css: { type: 'stylesheet', syntax: 'css' },
  scss: { type: 'stylesheet', syntax: 'scss' },
  less: { type: 'stylesheet', syntax: 'less' },
  javascript: { type: 'markup', syntax: 'jsx', options: { 'jsx.enabled': true } },
  typescript: { type: 'markup', syntax: 'jsx', options: { 'jsx.enabled': true } },
};

export function isEmmetEligibleLanguage(languageId: string): boolean {
  return languageId in LANGUAGE_CONFIG;
}

export interface EmmetExpansionResult {
  startColumn: number;
  endColumn: number;
  expanded: string;
}

/** Pure (no Monaco dependency): line text + column + language id in, replacement range + expansion out, so it's unit-testable without an editor. */
export function computeEmmetExpansion(lineText: string, column: number, languageId: string): EmmetExpansionResult | null {
  const config = LANGUAGE_CONFIG[languageId];
  if (!config) return null;

  const extracted = extract(lineText, column - 1, { type: config.type });
  if (!extracted || !extracted.abbreviation) return null;

  let expanded: string;
  try {
    expanded = expand(extracted.abbreviation, config);
  } catch {
    return null;
  }
  if (!expanded || expanded === extracted.abbreviation) return null;

  return {
    startColumn: extracted.start + 1,
    endColumn: extracted.end + 1,
    expanded,
  };
}


export function registerEmmetTabAction(editor: any, monaco: any): void {
  const abbreviationAvailable = editor.createContextKey('sdeEmmetAbbreviationAvailable', false);

  const recompute = () => {
    const model = editor.getModel();
    const position = editor.getPosition();
    const selection = editor.getSelection();
    if (!model || !position || !selection || !selection.isEmpty()) {
      abbreviationAvailable.set(false);
      return;
    }
    const languageId = model.getLanguageId();
    if (!isEmmetEligibleLanguage(languageId)) {
      abbreviationAvailable.set(false);
      return;
    }
    const lineText = model.getLineContent(position.lineNumber);
    const result = computeEmmetExpansion(lineText, position.column, languageId);
    abbreviationAvailable.set(result !== null);
  };

  editor.onDidChangeCursorPosition(recompute);
  editor.onDidChangeModelContent(recompute);
  editor.onDidChangeModel(recompute);
  recompute();

  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;
      const languageId = model.getLanguageId();
      const lineText = model.getLineContent(position.lineNumber);
      const result = computeEmmetExpansion(lineText, position.column, languageId);
      if (!result) return;

      const range = new monaco.Range(position.lineNumber, result.startColumn, position.lineNumber, result.endColumn);
      editor.executeEdits('emmet-expand', [{ range, text: result.expanded }]);
      editor.pushUndoStop();
    },
    'sdeEmmetAbbreviationAvailable && !suggestWidgetVisible && !inSnippetMode',
  );
}
