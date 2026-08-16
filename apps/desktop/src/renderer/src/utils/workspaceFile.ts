/** Pure read/write logic for .sde-workspace files — no IO, so both directions are unit-testable. workspace.ts owns the actual dialog/fs calls and passes content through these. */
export interface WorkspaceFileFolder {
  path: string;
  name: string;
}

/** Raw file content in, its folder list out. Invalid entries are dropped rather than thrown — one corrupted entry shouldn't block restoring the rest of a workspace. */
export function parseWorkspaceFile(raw: string): WorkspaceFileFolder[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const folders = (parsed as { folders?: unknown } | null)?.folders;
  if (!Array.isArray(folders)) return [];
  return folders.filter((f): f is WorkspaceFileFolder =>
    !!f && typeof f === 'object' && typeof (f as WorkspaceFileFolder).path === 'string' && typeof (f as WorkspaceFileFolder).name === 'string',
  );
}

/** The inverse of parseWorkspaceFile — only ever writes the path/name
 * fields, even if a caller's WorkspaceFolder objects carry extra ones. */
export function serializeWorkspaceFile(folders: WorkspaceFileFolder[]): string {
  return JSON.stringify({ folders: folders.map((f) => ({ path: f.path, name: f.name })) }, null, 2);
}
