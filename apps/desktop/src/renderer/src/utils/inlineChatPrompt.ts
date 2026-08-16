export interface InlineChatPromptParams {
  fileContent: string;
  languageId: string;
  instruction: string;
  /** The exact selected text for a selection-replace request; null for a cursor-only insert. */
  selectedText: string | null;
  /** Character offset into fileContent where the cursor sits — only used for the insert-mode prompt's <<<CURSOR>>> marker. */
  cursorOffset: number;
}

/** Builds the prompt for a single scoped edit (Ctrl+I) — asks for just the replacement/insertion snippet, not a whole-file rewrite, though the full file is still included as context. */
export function buildInlineChatPrompt(params: InlineChatPromptParams): string {
  const { fileContent, languageId, instruction, selectedText, cursorOffset } = params;

  if (selectedText !== null) {
    return `You are editing a code file. Here is the full file for context:

\`\`\`${languageId}
${fileContent}
\`\`\`

The user selected this exact snippet to change:
\`\`\`${languageId}
${selectedText}
\`\`\`

Instructions: ${instruction}

Output ONLY the replacement code for the selected snippet, wrapped in a single markdown code block. Do not include any explanation before or after the code block, and do not repeat the rest of the file.`;
  }

  const before = fileContent.slice(0, cursorOffset);
  const after = fileContent.slice(cursorOffset);
  return `You are editing a code file. Here is the full file for context, with the cursor position marked as <<<CURSOR>>>:

\`\`\`${languageId}
${before}<<<CURSOR>>>${after}
\`\`\`

Instructions: ${instruction}

Output ONLY the code to insert at the <<<CURSOR>>> position, wrapped in a single markdown code block. Do not include any explanation before or after the code block, and do not include any of the surrounding file content.`;
}

/** Splices a replacement string into fileContent between startOffset and endOffset; a cursor-only insert is just the zero-width case (startOffset === endOffset). */
export function applyInlineChatEdit(fileContent: string, startOffset: number, endOffset: number, replacement: string): string {
  return fileContent.slice(0, startOffset) + replacement + fileContent.slice(endOffset);
}
