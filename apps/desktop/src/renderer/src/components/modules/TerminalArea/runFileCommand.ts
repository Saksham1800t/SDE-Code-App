// Extension -> shell command for "Run Active File". Deliberately small and
// honest: only languages with a real, unambiguous single-file run command
// are included — compiled/project-based languages (Rust, Java, C++) aren't,
// since "run this one file" isn't a coherent operation for them without a
// build system in the loop.
const RUN_COMMANDS: Record<string, (quotedPath: string) => string> = {
  '.py': (p) => `python ${p}`,
  '.js': (p) => `node ${p}`,
  '.mjs': (p) => `node ${p}`,
  '.cjs': (p) => `node ${p}`,
  '.ts': (p) => `npx tsx ${p}`,
  '.sh': (p) => `bash ${p}`,
  '.rb': (p) => `ruby ${p}`,
  '.php': (p) => `php ${p}`,
  '.go': (p) => `go run ${p}`,
  '.ps1': (p) => `powershell -File ${p}`,
};

export function getRunCommandForFile(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  const build = RUN_COMMANDS[ext];
  if (!build) return null;
  const quoted = `"${filePath}"`;
  return build(quoted);
}
