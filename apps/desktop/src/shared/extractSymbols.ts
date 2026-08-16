export interface FileSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'variable' | 'method';
  line: number;
}

/** Lightweight, regex-based symbol extraction — a heuristic fallback for "jump to symbol" since no language service (TS worker/LSP) exists yet; other languages return no symbols. */
export function extractSymbols(content: string, languageId: string): FileSymbol[] {
  const lines = content.split('\n');
  const symbols: FileSymbol[] = [];

  const jsLike = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'];
  if (jsLike.includes(languageId)) {
    const patterns: Array<[RegExp, FileSymbol['kind']]> = [
      [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, 'function'],
      [/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
      [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
      [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?.*=>/, 'function'],
      [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 'variable'],
      [/^\s*(?:public|private|protected|static|async)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[\w<>[\],\s|&]+)?\s*\{/, 'method'],
    ];
    lines.forEach((lineText, idx) => {
      for (const [re, kind] of patterns) {
        const m = lineText.match(re);
        if (m && m[1] && !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
          symbols.push({ name: m[1], kind, line: idx + 1 });
          break;
        }
      }
    });
  } else if (languageId === 'python') {
    const patterns: Array<[RegExp, FileSymbol['kind']]> = [
      [/^\s*def\s+([A-Za-z_]\w*)/, 'function'],
      [/^\s*class\s+([A-Za-z_]\w*)/, 'class'],
    ];
    lines.forEach((lineText, idx) => {
      for (const [re, kind] of patterns) {
        const m = lineText.match(re);
        if (m && m[1]) {
          symbols.push({ name: m[1], kind, line: idx + 1 });
          break;
        }
      }
    });
  }

  return symbols;
}
