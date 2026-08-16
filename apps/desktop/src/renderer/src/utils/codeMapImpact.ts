import type { ImpactReport } from '@sde-code/protocol';
import type { WorkspaceFolder } from '../store/workspace';
import { useTasksStore } from '../store/tasks';
import { detectTestRunnerCommand } from './detectTestRunner';

// Shared plumbing for every Code Map + AI Impact Analysis surface that needs to go from an absolute file path to an ImpactReport, or run the tests it suggests.

export const findOwningFolder = (filePath: string, folders: WorkspaceFolder[]): WorkspaceFolder | undefined =>
  folders.find((f) => filePath === f.path || filePath.startsWith(f.path + '/') || filePath.startsWith(f.path + '\\'));

export const toRelativePath = (filePath: string, folder: WorkspaceFolder): string =>
  filePath.slice(folder.path.length).replace(/^[\\/]/, '').replace(/\\/g, '/');

export const toAbsolutePath = (relativePath: string, folder: WorkspaceFolder): string => `${folder.path}/${relativePath}`;

export async function fetchImpactForFile(filePath: string, folders: WorkspaceFolder[]): Promise<ImpactReport | null> {
  const api = window.api;
  if (!api?.getImpact) return null;
  const owningFolder = findOwningFolder(filePath, folders);
  if (!owningFolder) return null;
  const relPath = toRelativePath(filePath, owningFolder);
  const projectId = owningFolder.name || 'default_proj';
  try {
    return await api.getImpact(projectId, owningFolder.path, relPath);
  } catch (err) {
    console.error('Failed to compute impact:', err);
    return null;
  }
}

export async function runSuggestedTests(workspacePath: string, testPaths: string[]): Promise<void> {
  if (testPaths.length === 0) return;
  const detected = await detectTestRunnerCommand(workspacePath, testPaths);
  if (!detected) return;
  useTasksStore.getState().runTask({ id: 'impact-suggested-tests', name: 'Suggested Tests', command: detected.command });
}
