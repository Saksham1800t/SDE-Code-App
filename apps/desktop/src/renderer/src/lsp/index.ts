import { allLspLanguages, languageForFile, loadExtensionLanguages } from './languageRegistry';
import { registerLspLanguageClient, notifyDocumentOpened, notifyDocumentChanged, notifyDocumentClosed } from './lspLanguageClient';

/**
 * Call once at renderer startup — registers Monaco providers for every
 * built-in language immediately, then again for any extension-contributed
 * ones once that IPC round-trip resolves. Adding a *built-in* language
 * means one entry in languageRegistry.ts + lspService.ts; adding one via an
 * *extension* needs no code change here at all — it shows up automatically
 * once the extension declares `contributes.languageServers`.
 */
export async function registerAllLspLanguageClients(): Promise<void> {
  for (const { languageId } of allLspLanguages()) {
    registerLspLanguageClient(languageId);
  }
  await loadExtensionLanguages();
  for (const { languageId } of allLspLanguages()) {
    registerLspLanguageClient(languageId);
  }
}

export function isLspManagedFile(filePath: string): boolean {
  return languageForFile(filePath) !== null;
}

export function notifyFileOpened(filePath: string, content: string): void {
  const lang = languageForFile(filePath);
  if (lang) notifyDocumentOpened(lang.languageId, filePath, content);
}

export function notifyFileChanged(filePath: string, content: string): void {
  const lang = languageForFile(filePath);
  if (lang) notifyDocumentChanged(lang.languageId, filePath, content);
}

export function notifyFileClosed(filePath: string): void {
  const lang = languageForFile(filePath);
  if (lang) notifyDocumentClosed(lang.languageId, filePath);
}
