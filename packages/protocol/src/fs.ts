/** Canonical shapes for the fs:* IPC boundary — this package owns them, platform/fs/fileSystemService.ts imports them. */

export interface FsDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface OpenFolderResult {
  id: string;
  name: string;
  path: string;
}

export type ProjectTrustState = 'trusted' | 'restricted' | null;

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}

/** A Local History entry's list-view shape — excludes `content`, fetched separately via `fs:getFileSnapshotContent` when opened. */
export interface FileHistoryEntry {
  id: string;
  timestamp: number;
}

export type FsIpcContract = {
  /** Opens the native folder-picker and registers the chosen folder as a project; returns null if cancelled. Handler stays inline in host/ipc.ts. */
  'fs:openFolder': () => Promise<OpenFolderResult | null>;
  /** Workspace Trust — null means never asked (renderer should prompt); otherwise the persisted per-folder decision. */
  'fs:getProjectTrust': (folderPath: string) => Promise<ProjectTrustState>;
  'fs:setProjectTrust': (folderPath: string, state: 'trusted' | 'restricted') => Promise<boolean>;
  /** Every previously-opened folder, most-recently-opened first — backs the Welcome page's "Recent" list. */
  'fs:getRecentProjects': (limit?: number) => Promise<RecentProject[]>;
  'fs:readDir': (dirPath: string) => Promise<FsDirEntry[]>;
  'fs:readFile': (filePath: string) => Promise<string>;
  'fs:writeFile': (filePath: string, content: string) => Promise<boolean>;
  'fs:createFile': (filePath: string) => Promise<boolean>;
  'fs:createDirectory': (dirPath: string) => Promise<boolean>;
  'fs:deleteFile': (filePath: string) => Promise<boolean>;
  /** Deletes a file OR directory (recursively) — a separate channel since fs:deleteFile is files-only for existing callers. */
  'fs:deletePath': (targetPath: string) => Promise<boolean>;
  'fs:renamePath': (oldPath: string, newPath: string) => Promise<boolean>;
  /** Shows the given path in the OS's native file manager (Explorer/Finder). */
  'fs:revealInExplorer': (targetPath: string) => Promise<boolean>;
  /** Local History auto-snapshot, scoped per (workspace, file path); no-ops on unchanged content and prunes to 50 per file. */
  'fs:saveFileSnapshot': (workspacePath: string, filePath: string, content: string) => Promise<boolean>;
  /** Most recent first. */
  'fs:getFileHistory': (workspacePath: string, filePath: string) => Promise<FileHistoryEntry[]>;
  'fs:getFileSnapshotContent': (id: string) => Promise<string | null>;
  /** Native "Save As" dialog pre-filtered to .sde-workspace files — returns the chosen path (not yet written), or null if cancelled. */
  'fs:showSaveWorkspaceDialog': () => Promise<string | null>;
  /** Native "Open" dialog pre-filtered to .sde-workspace files — returns the chosen path, or null if cancelled. */
  'fs:showOpenWorkspaceDialog': () => Promise<string | null>;
};
