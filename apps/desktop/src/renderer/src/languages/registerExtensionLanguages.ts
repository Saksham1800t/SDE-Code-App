import * as monaco from 'monaco-editor';

/**
 * The piece language-server/debug-adapter contributions don't cover:
 * teaching Monaco that a language exists at all. `contributes.languages`
 * lets an extension register a new language id + file extensions, an
 * optional Monarch tokenizer for syntax highlighting, and basic
 * bracket/comment/auto-closing configuration — no code required, same as
 * the other extension-capability contributions this session built.
 *
 * Known limitation: this is fetched over IPC at startup, same as
 * loadExtensionLanguages()/loadExtensionDebugLanguages() — if a file of a
 * brand-new extension-contributed language is opened before this resolves,
 * Monaco won't recognize its extension yet and it'll open as plaintext.
 * Same accepted tradeoff as those two, for the same reason: blocking app
 * startup on this fetch would be worse than the rare race.
 */
export async function registerExtensionLanguages(): Promise<void> {
  const contributions = await window.api.getExtensionLanguageDefinitions?.().catch(() => []) ?? [];

  for (const contribution of contributions) {
    monaco.languages.register({
      id: contribution.languageId,
      extensions: contribution.extensions,
      aliases: contribution.aliases,
    });

    if (contribution.monarch) {
      monaco.languages.setMonarchTokensProvider(contribution.languageId, contribution.monarch as monaco.languages.IMonarchLanguage);
    }
    if (contribution.configuration) {
      monaco.languages.setLanguageConfiguration(contribution.languageId, contribution.configuration as monaco.languages.LanguageConfiguration);
    }
  }
}
