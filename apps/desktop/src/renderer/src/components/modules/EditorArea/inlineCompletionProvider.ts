import { useAgentStore } from '../../../store/agent';

const PREFIX_LINES = 60;
const SUFFIX_LINES = 20;
const MAX_PREFIX_CHARS = 6000;
const MAX_SUFFIX_CHARS = 2000;
const DEBOUNCE_MS = 300;


function waitDebounced(token: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose(): void } }): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancelListener.dispose();
      resolve(true);
    }, DEBOUNCE_MS);
    const cancelListener = token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}


let registered = false;

export function registerInlineCompletionProvider(monaco: any) {
  if (registered) return;
  registered = true;

  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model: any, position: any, _context: any, token: any) {
      const { inlineCompletionEnabled, activeAIProvider, activeAIModel } = useAgentStore.getState();
      if (!inlineCompletionEnabled) return { items: [] };

      const api = window.api;
      if (!api?.completeInlineAI) return { items: [] };

      const proceed = await waitDebounced(token);
      if (!proceed || token.isCancellationRequested) return { items: [] };

      const startLine = Math.max(1, position.lineNumber - PREFIX_LINES);
      const prefix = model
        .getValueInRange({ startLineNumber: startLine, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
        .slice(-MAX_PREFIX_CHARS);

      const endLine = Math.min(model.getLineCount(), position.lineNumber + SUFFIX_LINES);
      const suffix = model
        .getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine) })
        .slice(0, MAX_SUFFIX_CHARS);

      let text = '';
      try {
        text = await api.completeInlineAI({ provider: activeAIProvider, model: activeAIModel, prefix, suffix, language: model.getLanguageId() });
      } catch (err) {
        console.error('Inline completion request failed:', err);
        return { items: [] };
      }

      if (token.isCancellationRequested || !text || !text.trim()) return { items: [] };

      return { items: [{ insertText: text }] };
    },
    handleItemDidShow() { },
    freeInlineCompletions() { },
    disposeInlineCompletions() { },
  });
}
