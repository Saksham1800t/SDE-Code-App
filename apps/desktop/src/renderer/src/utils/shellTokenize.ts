/**
 * Splits a user-typed argument string into an argv array, the same way a shell would —
 * respecting single/double quotes so an argument like `--message "fix the bug"` becomes one
 * token, not two. Used only to turn the External Agents Settings tab's single text field into
 * ExternalAgentConfig.args; the resulting array is what's actually passed to the main
 * process's `spawn()` (no `shell: true`), so this is a UI convenience, not part of the
 * security boundary.
 */
export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let inToken = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }
    current += ch;
    inToken = true;
  }
  if (inToken) tokens.push(current);

  return tokens;
}
