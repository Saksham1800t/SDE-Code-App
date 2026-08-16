/** Curated starter content for likely-used languages — a real working example, not the generic placeholder, so a first-time user sees a snippet fire; anything unlisted falls back to genericSnippetTemplate(). */
export const SNIPPET_TEMPLATES: Record<string, string> = {
  javascript: JSON.stringify(
    { 'Print to console': { prefix: 'log', body: ["console.log($1);"], description: 'Log output to console' } },
    null,
    '\t',
  ),
  typescript: JSON.stringify(
    { 'Print to console': { prefix: 'log', body: ["console.log($1);"], description: 'Log output to console' } },
    null,
    '\t',
  ),
  python: JSON.stringify(
    { Print: { prefix: 'print', body: ['print($1)'], description: 'Print to stdout' } },
    null,
    '\t',
  ),
  java: JSON.stringify(
    { 'Print line': { prefix: 'sout', body: ['System.out.println($1);'], description: 'Print a line' } },
    null,
    '\t',
  ),
  csharp: JSON.stringify(
    { 'Print line': { prefix: 'cw', body: ['Console.WriteLine($1);'], description: 'Print a line' } },
    null,
    '\t',
  ),
  go: JSON.stringify(
    { 'Print line': { prefix: 'pln', body: ['fmt.Println($1)'], description: 'Print a line' } },
    null,
    '\t',
  ),
  rust: JSON.stringify(
    { 'Print line': { prefix: 'pln', body: ['println!("$1");'], description: 'Print a line' } },
    null,
    '\t',
  ),
  html: JSON.stringify(
    {
      'HTML5 boilerplate': {
        prefix: 'html5',
        body: ['<!DOCTYPE html>', '<html>', '<head><title>$1</title></head>', '<body>$2</body>', '</html>'],
        description: 'Basic HTML5 skeleton',
      },
    },
    null,
    '\t',
  ),
  css: JSON.stringify(
    {
      'Flex center': {
        prefix: 'flexcenter',
        body: ['display: flex;', 'align-items: center;', 'justify-content: center;'],
        description: 'Center children with flexbox',
      },
    },
    null,
    '\t',
  ),
  json: JSON.stringify(
    { 'Key-value pair': { prefix: 'kv', body: ['"$1": "$2"'], description: 'A JSON key/value pair' } },
    null,
    '\t',
  ),
  ruby: JSON.stringify(
    { 'Print line': { prefix: 'puts', body: ['puts $1'], description: 'Print a line' } },
    null,
    '\t',
  ),
  php: JSON.stringify(
    { Print: { prefix: 'echo', body: ['echo $1;'], description: 'Print output' } },
    null,
    '\t',
  ),
};

/** Fallback for languages not in the curated set above. */
export function genericSnippetTemplate(languageId: string): string {
  return `{
\t// Place your ${languageId} snippets here. Each snippet is defined under a
\t// snippet name and has a prefix, body and description. The prefix is what
\t// is used to trigger the snippet and the body will be expanded and
\t// inserted. Possible variables are tabstops ($1, $2) and placeholders
\t// (\${1:defaultText}). Example:
\t//
\t// "Print to console": {
\t// \t"prefix": "log",
\t// \t"body": ["console.log('$1');", "$2"],
\t// \t"description": "Log output to console"
\t// }
}
`;
}
