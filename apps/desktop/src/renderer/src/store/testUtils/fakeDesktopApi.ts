import { vi } from 'vitest';
import type { DesktopApi } from '../../../../preload';

/** Hand-written fake of window.api for renderer store tests (no mocking library, matching FakeLogService elsewhere). Extend as new stores need more of the surface. */
export function createFakeDesktopApi(overrides: Partial<DesktopApi> = {}): Partial<DesktopApi> {
  return {
    platform: 'win32',

    getFlags: vi.fn(async () => []),
    setFlag: vi.fn(async () => {}),
    clearWorkspaceFlagOverride: vi.fn(async () => {}),

    getSettings: vi.fn(async () => ({})),
    setSetting: vi.fn(async () => {}),

    getCommands: vi.fn(async () => []),
    getKeybindings: vi.fn(async () => []),
    setKeybinding: vi.fn(async () => true),
    resetKeybindings: vi.fn(async () => true),
    getProfiles: vi.fn(async () => [{ id: 'default', name: 'Default', created_at: 0 }]),
    createProfile: vi.fn(async () => true),
    renameProfile: vi.fn(async () => true),
    deleteProfile: vi.fn(async () => true),

    getThemes: vi.fn(async () => []),
    getExtensionThemes: vi.fn(async () => []),
    saveTheme: vi.fn(async () => {}),

    gitStatus: vi.fn(async () => null),
    gitInit: vi.fn(async () => {}),
    gitStage: vi.fn(async () => {}),
    gitUnstage: vi.fn(async () => {}),
    gitStageAll: vi.fn(async () => {}),
    gitUnstageAll: vi.fn(async () => {}),
    gitCommit: vi.fn(async () => {}),
    gitPush: vi.fn(async () => {}),
    gitPull: vi.fn(async () => {}),
    gitFetch: vi.fn(async () => {}),
    gitDiff: vi.fn(async () => ({ original: '', modified: '' })),
    gitDiscardFile: vi.fn(async () => {}),
    gitDiscardAll: vi.fn(async () => {}),
    gitUndoLastCommit: vi.fn(async () => {}),
    gitAmendLastCommit: vi.fn(async () => {}),
    gitGetBranches: vi.fn(async () => ({ current: '', all: [] })),
    gitCreateBranch: vi.fn(async () => {}),
    gitCheckoutBranch: vi.fn(async () => {}),
    gitDeleteBranch: vi.fn(async () => {}),
    gitRenameBranch: vi.fn(async () => {}),
    gitPublishBranch: vi.fn(async () => {}),
    gitGetLog: vi.fn(async () => []),
    gitStashPush: vi.fn(async () => {}),
    gitStashPop: vi.fn(async () => {}),
    gitStashDrop: vi.fn(async () => {}),
    gitStashList: vi.fn(async () => []),
    gitGetStagedDiff: vi.fn(async () => ''),
    gitGetHeatmap: vi.fn(async () => ({})),
    gitGetRepoStats: vi.fn(async () => ({
      commitCount: 0,
      branchCount: 0,
      contributorCount: 0,
      tagCount: 0,
      latestTag: null,
      latestCommit: null,
    })),
    gitGetCommitFiles: vi.fn(async () => []),
    gitGetCommitDiff: vi.fn(async () => ({ original: '', modified: '' })),
    gitGetFileHotspots: vi.fn(async () => []),
    gitGetCommitPatch: vi.fn(async () => ''),
    gitGetBranchDiff: vi.fn(async () => []),
    gitGetBranchFileDiff: vi.fn(async () => ({ original: '', modified: '' })),
    gitGetCommitGraph: vi.fn(async () => []),
    gitDiscoverRepos: vi.fn(async () => []),
    gitGetFileCommitHistory: vi.fn(async () => []),
    onAIChunk: vi.fn(() => () => {}),
    onAIErr: vi.fn(() => () => {}),
    queryAI: vi.fn(async () => {}),

    createTerminal: vi.fn(async () => {}),
    closeTerminal: vi.fn(async () => {}),
    getPathExecutables: vi.fn(async () => []),

    deleteFile: vi.fn(async () => {}),
    deletePath: vi.fn(async () => true),
    renamePath: vi.fn(async () => true),
    revealInExplorer: vi.fn(async () => true),
    writeFile: vi.fn(async () => {}),

    startNotebookKernel: vi.fn(async () => ({ kernelId: 'kernel_fake' })),
    executeNotebookCell: vi.fn(async () => ({ executionId: 'exec_fake' })),
    interruptNotebookKernel: vi.fn(async () => {}),
    restartNotebookKernel: vi.fn(async () => {}),
    stopNotebookKernel: vi.fn(async () => {}),
    onNotebookCellOutput: vi.fn(() => () => {}),
    onNotebookCellDone: vi.fn(() => () => {}),
    onNotebookKernelStatus: vi.fn(() => () => {}),

    getCodeGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
    getImpact: vi.fn(async (_projectId: string, _workspacePath: string, filePath: string) => ({
      filePath,
      directlyImports: [],
      matchesRoute: [],
      suggestedTests: [],
    })),

    ...overrides,
  } as Partial<DesktopApi>;
}

/** Installs the fake api as `window.api` for the duration of a test file/suite. */
export function installFakeDesktopApi(overrides: Partial<DesktopApi> = {}): Partial<DesktopApi> {
  const api = createFakeDesktopApi(overrides);
  (globalThis as any).window = { ...(globalThis as any).window, api };
  return api;
}
