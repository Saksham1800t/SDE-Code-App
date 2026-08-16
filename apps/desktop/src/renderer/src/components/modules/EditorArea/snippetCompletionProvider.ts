interface SnippetDefinition {
  name: string;
  prefix: string | string[];
  body: string | string[];
  description?: string;
}

// Registered once for the app's lifetime — Monaco stacks providers rather than replacing them on re-registration.
let registered = false;

export function registerSnippetCompletionProvider(monaco: any) {
  if (registered) return;
  registered = true;

  // Unlike registerInlineCompletionsProvider (which genuinely treats '*' as
  // "all languages"), monaco-editor's standalone registerCompletionItemProvider
  const languageIds = monaco.languages.getLanguages().map((l: { id: string }) => l.id);

  monaco.languages.registerCompletionItemProvider(languageIds, {
    async provideCompletionItems(model: any, position: any) {
      const api = window.api;
      if (!api?.getSnippetsForLanguage) return { suggestions: [] };

      let snippets: SnippetDefinition[] = [];
      try {
        snippets = await api.getSnippetsForLanguage(model.getLanguageId());
      } catch (err) {
        console.error('Failed to load snippets:', err);
        return { suggestions: [] };
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = snippets.flatMap((snippet) => {
        const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        const insertText = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
        return prefixes.map((prefix) => ({
          label: prefix,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: snippet.description ?? snippet.name,
          detail: snippet.name,
          range,
          sortText: `0${prefix}`,
          preselect: true,
        }));
      });

      return { suggestions };
    },
  });
}
