import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useGitStore } from './git';
import { useWorkspaceStore } from './workspace';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useGitStore', () => {
  beforeEach(() => {
    useGitStore.setState(useGitStore.getInitialState());
    // Resets `groups` too, not just the openTabs/activeTabPath mirror —
    // those are recomputed FROM groups by every group-aware workspace
    // action, so leaving a prior test's accumulated groups[0].tabs in place
    // would silently resurrect stale tabs the next time e.g. setActiveTab()
    // or openSyntheticTab() runs and recomputes the mirror.
    useWorkspaceStore.setState({
      workspacePath: '/repo',
      workspaceFolders: [{ path: '/repo', name: 'repo' }],
      groups: [{ id: 'group_test', tabs: [], activeTabPath: null, editorInstance: null }],
      activeGroupId: 'group_test',
      openTabs: [],
      activeTabPath: null,
    });
    installFakeDesktopApi();
  });

  it('loadGitStatus is a no-op without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitStatus = vi.fn(async () => ({ branch: 'main' }));
    installFakeDesktopApi({ gitStatus: gitStatus as any });

    await useGitStore.getState().loadGitStatus();

    expect(gitStatus).not.toHaveBeenCalled();
    expect(useGitStore.getState().gitRepoStatus).toBeNull();
  });

  it('loadGitStatus stores the status for the current workspace path', async () => {
    const status = { branch: 'main', staged: [], unstaged: [], untracked: [] };
    const gitStatus = vi.fn(async () => status);
    installFakeDesktopApi({ gitStatus: gitStatus as any });

    await useGitStore.getState().loadGitStatus();

    expect(gitStatus).toHaveBeenCalledWith('/repo');
    expect(useGitStore.getState().gitRepoStatus).toEqual(status);
  });

  it('gitLoadRepoStats is a no-op without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitGetRepoStats = vi.fn(async () => ({ commitCount: 5, branchCount: 2, contributorCount: 1, tagCount: 0, latestTag: null, latestCommit: null }));
    installFakeDesktopApi({ gitGetRepoStats: gitGetRepoStats as any });

    await useGitStore.getState().gitLoadRepoStats();

    expect(gitGetRepoStats).not.toHaveBeenCalled();
    expect(useGitStore.getState().repoStats).toBeNull();
  });

  it('gitLoadRepoStats stores the stats for the current workspace path', async () => {
    const stats = { commitCount: 5, branchCount: 2, contributorCount: 1, tagCount: 1, latestTag: 'v1.0.0', latestCommit: null };
    const gitGetRepoStats = vi.fn(async () => stats);
    installFakeDesktopApi({ gitGetRepoStats: gitGetRepoStats as any });

    await useGitStore.getState().gitLoadRepoStats();

    expect(gitGetRepoStats).toHaveBeenCalledWith('/repo');
    expect(useGitStore.getState().repoStats).toEqual(stats);
  });

  it('gitLoadCommitFiles is a no-op without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitGetCommitFiles = vi.fn(async () => [{ path: 'a.ts', insertions: 1, deletions: 0, statusText: 'Added' }]);
    installFakeDesktopApi({ gitGetCommitFiles: gitGetCommitFiles as any });

    await useGitStore.getState().gitLoadCommitFiles('abc123');

    expect(gitGetCommitFiles).not.toHaveBeenCalled();
    expect(useGitStore.getState().commitFiles).toBeNull();
  });

  it('gitLoadCommitFiles stores the files for the given commit hash', async () => {
    const files = [{ path: 'a.ts', insertions: 3, deletions: 1, statusText: 'Modified' }];
    const gitGetCommitFiles = vi.fn(async () => files);
    installFakeDesktopApi({ gitGetCommitFiles: gitGetCommitFiles as any });

    await useGitStore.getState().gitLoadCommitFiles('abc123');

    expect(gitGetCommitFiles).toHaveBeenCalledWith('/repo', 'abc123');
    expect(useGitStore.getState().commitFiles).toEqual(files);
  });

  it('gitLoadFileHotspots is a no-op without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitGetFileHotspots = vi.fn(async () => [{ path: 'a.ts', changeCount: 5 }]);
    installFakeDesktopApi({ gitGetFileHotspots: gitGetFileHotspots as any });

    await useGitStore.getState().gitLoadFileHotspots();

    expect(gitGetFileHotspots).not.toHaveBeenCalled();
    expect(useGitStore.getState().fileHotspots).toBeNull();
  });

  it('gitLoadFileHotspots stores the hotspots for the current workspace path', async () => {
    const hotspots = [{ path: 'a.ts', changeCount: 5 }, { path: 'b.ts', changeCount: 2 }];
    const gitGetFileHotspots = vi.fn(async () => hotspots);
    installFakeDesktopApi({ gitGetFileHotspots: gitGetFileHotspots as any });

    await useGitStore.getState().gitLoadFileHotspots();

    expect(gitGetFileHotspots).toHaveBeenCalledWith('/repo');
    expect(useGitStore.getState().fileHotspots).toEqual(hotspots);
  });

  it('gitGetCommitPatch is a no-op (empty string) without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitGetCommitPatch = vi.fn(async () => 'diff --git a/a.ts b/a.ts');
    installFakeDesktopApi({ gitGetCommitPatch: gitGetCommitPatch as any });

    const result = await useGitStore.getState().gitGetCommitPatch('abc123');

    expect(gitGetCommitPatch).not.toHaveBeenCalled();
    expect(result).toBe('');
  });

  it('gitGetCommitPatch returns the patch text for the current workspace path', async () => {
    const gitGetCommitPatch = vi.fn(async () => 'diff --git a/a.ts b/a.ts');
    installFakeDesktopApi({ gitGetCommitPatch: gitGetCommitPatch as any });

    const result = await useGitStore.getState().gitGetCommitPatch('abc123');

    expect(gitGetCommitPatch).toHaveBeenCalledWith('/repo', 'abc123');
    expect(result).toBe('diff --git a/a.ts b/a.ts');
  });

  it('gitLoadBranchComparison is a no-op without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitGetBranchDiff = vi.fn(async () => [{ path: 'a.ts', insertions: 1, deletions: 0, statusText: 'Modified' }]);
    installFakeDesktopApi({ gitGetBranchDiff: gitGetBranchDiff as any });

    await useGitStore.getState().gitLoadBranchComparison('main', 'feature');

    expect(gitGetBranchDiff).not.toHaveBeenCalled();
    expect(useGitStore.getState().branchComparison).toBeNull();
  });

  it('gitLoadBranchComparison stores the diff between the two given branches', async () => {
    const files = [{ path: 'a.ts', insertions: 3, deletions: 1, statusText: 'Modified' }];
    const gitGetBranchDiff = vi.fn(async () => files);
    installFakeDesktopApi({ gitGetBranchDiff: gitGetBranchDiff as any });

    await useGitStore.getState().gitLoadBranchComparison('main', 'feature');

    expect(gitGetBranchDiff).toHaveBeenCalledWith('/repo', 'main', 'feature');
    expect(useGitStore.getState().branchComparison).toEqual(files);
  });

  it('gitOpenBranchFileDiff reuses an already-open branch-diff tab instead of creating a duplicate', async () => {
    const seededTab = { path: 'branchdiff:main...feature:src/a.ts', name: 'Diff: a.ts (main...feature)', isDirty: false } as any;
    useWorkspaceStore.setState({
      groups: [{ id: 'group_test', tabs: [seededTab], activeTabPath: null, editorInstance: null }],
      openTabs: [seededTab],
      activeTabPath: null,
    });
    const gitGetBranchFileDiff = vi.fn(async () => ({ original: '', modified: '' }));
    installFakeDesktopApi({ gitGetBranchFileDiff: gitGetBranchFileDiff as any });

    await useGitStore.getState().gitOpenBranchFileDiff('main', 'feature', 'src/a.ts', 'a.ts');

    expect(gitGetBranchFileDiff).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeTabPath).toBe('branchdiff:main...feature:src/a.ts');
  });

  it('gitOpenBranchFileDiff fetches the diff and opens a new tab using a distinct path prefix from openDiff/gitOpenCommitFileDiff', async () => {
    const gitGetBranchFileDiff = vi.fn(async () => ({ original: 'old', modified: 'new' }));
    installFakeDesktopApi({ gitGetBranchFileDiff: gitGetBranchFileDiff as any });

    await useGitStore.getState().gitOpenBranchFileDiff('main', 'feature', 'src/a.ts', 'a.ts');

    expect(gitGetBranchFileDiff).toHaveBeenCalledWith('/repo', 'main', 'feature', 'src/a.ts');
    const { openTabs, activeTabPath } = useWorkspaceStore.getState();
    expect(activeTabPath).toBe('branchdiff:main...feature:src/a.ts');
    expect(openTabs).toHaveLength(1);
    expect(openTabs[0]).toMatchObject({ path: 'branchdiff:main...feature:src/a.ts', originalContent: 'old', content: 'new', isDiff: true });
  });

  it('gitLoadGitGraph is a no-op without an open workspace', async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    const gitGetCommitGraph = vi.fn(async () => [{ hash: 'a', shortHash: 'a', message: 'm', author: 'x', date: 'd', refs: '', parents: [] }]);
    installFakeDesktopApi({ gitGetCommitGraph: gitGetCommitGraph as any });

    await useGitStore.getState().gitLoadGitGraph(true);

    expect(gitGetCommitGraph).not.toHaveBeenCalled();
    expect(useGitStore.getState().gitGraphCommits).toBeNull();
  });

  it('gitLoadGitGraph(true) fetches the first page and replaces any existing commits', async () => {
    useGitStore.setState({ gitGraphCommits: [{ hash: 'stale', shortHash: 'stale', message: '', author: '', date: '', refs: '', parents: [] }] as any });
    const page = [{ hash: 'a', shortHash: 'a', message: 'm', author: 'x', date: 'd', refs: '', parents: [] }];
    const gitGetCommitGraph = vi.fn(async () => page);
    installFakeDesktopApi({ gitGetCommitGraph: gitGetCommitGraph as any });

    await useGitStore.getState().gitLoadGitGraph(true);

    expect(gitGetCommitGraph).toHaveBeenCalledWith('/repo', 300, 0);
    expect(useGitStore.getState().gitGraphCommits).toEqual(page);
  });

  it('gitLoadGitGraph(false) appends the next page after the already-loaded commits', async () => {
    const firstPage = [{ hash: 'a', shortHash: 'a', message: 'm', author: 'x', date: 'd', refs: '', parents: [] }];
    useGitStore.setState({ gitGraphCommits: firstPage as any });
    const secondPage = [{ hash: 'b', shortHash: 'b', message: 'm2', author: 'x', date: 'd', refs: '', parents: ['a'] }];
    const gitGetCommitGraph = vi.fn(async () => secondPage);
    installFakeDesktopApi({ gitGetCommitGraph: gitGetCommitGraph as any });

    await useGitStore.getState().gitLoadGitGraph(false);

    expect(gitGetCommitGraph).toHaveBeenCalledWith('/repo', 300, 1);
    expect(useGitStore.getState().gitGraphCommits).toEqual([...firstPage, ...secondPage]);
  });

  it('gitLoadGitGraph sets gitGraphHasMore to false when a page comes back shorter than the page size', async () => {
    const shortPage = [{ hash: 'a', shortHash: 'a', message: 'm', author: 'x', date: 'd', refs: '', parents: [] }];
    const gitGetCommitGraph = vi.fn(async () => shortPage);
    installFakeDesktopApi({ gitGetCommitGraph: gitGetCommitGraph as any });

    await useGitStore.getState().gitLoadGitGraph(true);

    expect(useGitStore.getState().gitGraphHasMore).toBe(false);
  });

  it('gitStage stages the file then reloads status', async () => {
    const gitStage = vi.fn(async () => {});
    const gitStatus = vi.fn(async () => ({ branch: 'main' }));
    installFakeDesktopApi({ gitStage: gitStage as any, gitStatus: gitStatus as any });

    await useGitStore.getState().gitStage('src/a.ts');

    expect(gitStage).toHaveBeenCalledWith('/repo', 'src/a.ts');
    expect(gitStatus).toHaveBeenCalledWith('/repo');
  });

  it('gitCommit rejects a blank message without calling the api', async () => {
    const gitCommit = vi.fn(async () => {});
    installFakeDesktopApi({ gitCommit: gitCommit as any });

    await useGitStore.getState().gitCommit('   ');

    expect(gitCommit).not.toHaveBeenCalled();
  });

  it('gitCommit propagates a rejection from the api', async () => {
    installFakeDesktopApi({ gitCommit: vi.fn(async () => { throw new Error('nothing to commit'); }) as any });

    await expect(useGitStore.getState().gitCommit('a real message')).rejects.toThrow('nothing to commit');
  });

  it('gitCommitAndPush commits then pushes, in order', async () => {
    const calls: string[] = [];
    installFakeDesktopApi({
      gitCommit: vi.fn(async () => { calls.push('commit'); }) as any,
      gitPush: vi.fn(async () => { calls.push('push'); }) as any,
    });

    await useGitStore.getState().gitCommitAndPush('message');

    expect(calls).toEqual(['commit', 'push']);
  });

  it('gitCheckoutBranch reloads status and branches', async () => {
    const gitStatus = vi.fn(async () => ({ branch: 'main' }));
    const gitGetBranches = vi.fn(async () => ({ current: 'main', all: ['main'] }));
    installFakeDesktopApi({
      gitCheckoutBranch: vi.fn(async () => {}) as any,
      gitStatus: gitStatus as any,
      gitGetBranches: gitGetBranches as any,
    });

    await useGitStore.getState().gitCheckoutBranch('feature');

    expect(gitStatus).toHaveBeenCalled();
    expect(gitGetBranches).toHaveBeenCalled();
  });

  it('openDiff reuses an already-open diff tab instead of creating a duplicate', async () => {
    const seededTab = { path: 'gitdiff:src/a.ts', name: 'Diff: a.ts', isDirty: false } as any;
    useWorkspaceStore.setState({
      groups: [{ id: 'group_test', tabs: [seededTab], activeTabPath: null, editorInstance: null }],
      openTabs: [seededTab],
      activeTabPath: null,
    });
    const gitDiff = vi.fn(async () => ({ original: '', modified: '' }));
    installFakeDesktopApi({ gitDiff: gitDiff as any });

    await useGitStore.getState().openDiff('src/a.ts', 'a.ts');

    expect(gitDiff).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeTabPath).toBe('gitdiff:src/a.ts');
  });

  it('openDiff fetches the diff and opens a new tab when none exists yet', async () => {
    const gitDiff = vi.fn(async () => ({ original: 'old', modified: 'new' }));
    installFakeDesktopApi({ gitDiff: gitDiff as any });

    await useGitStore.getState().openDiff('src/a.ts', 'a.ts');

    expect(gitDiff).toHaveBeenCalledWith('/repo', 'src/a.ts');
    const { openTabs, activeTabPath } = useWorkspaceStore.getState();
    expect(activeTabPath).toBe('gitdiff:src/a.ts');
    expect(openTabs).toHaveLength(1);
    expect(openTabs[0]).toMatchObject({ path: 'gitdiff:src/a.ts', originalContent: 'old', content: 'new' });
  });

  it('gitOpenCommitFileDiff reuses an already-open commit-diff tab instead of creating a duplicate', async () => {
    const seededTab = { path: 'gitcommitdiff:abc123:src/a.ts', name: 'Diff: a.ts @ abc123', isDirty: false } as any;
    useWorkspaceStore.setState({
      groups: [{ id: 'group_test', tabs: [seededTab], activeTabPath: null, editorInstance: null }],
      openTabs: [seededTab],
      activeTabPath: null,
    });
    const gitGetCommitDiff = vi.fn(async () => ({ original: '', modified: '' }));
    installFakeDesktopApi({ gitGetCommitDiff: gitGetCommitDiff as any });

    await useGitStore.getState().gitOpenCommitFileDiff('abc123', 'src/a.ts', 'a.ts');

    expect(gitGetCommitDiff).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeTabPath).toBe('gitcommitdiff:abc123:src/a.ts');
  });

  it('gitOpenCommitFileDiff fetches the commit diff and opens a new tab using a distinct path prefix from openDiff', async () => {
    const gitGetCommitDiff = vi.fn(async () => ({ original: 'old', modified: 'new' }));
    installFakeDesktopApi({ gitGetCommitDiff: gitGetCommitDiff as any });

    await useGitStore.getState().gitOpenCommitFileDiff('abc123', 'src/a.ts', 'a.ts');

    expect(gitGetCommitDiff).toHaveBeenCalledWith('/repo', 'abc123', 'src/a.ts');
    const { openTabs, activeTabPath } = useWorkspaceStore.getState();
    expect(activeTabPath).toBe('gitcommitdiff:abc123:src/a.ts');
    expect(openTabs).toHaveLength(1);
    expect(openTabs[0]).toMatchObject({ path: 'gitcommitdiff:abc123:src/a.ts', originalContent: 'old', content: 'new', isDiff: true });
  });

  it('gitOpenCommitFileDiff uses an explicit dir when given, instead of the workspace path', async () => {
    const gitGetCommitDiff = vi.fn(async () => ({ original: 'old', modified: 'new' }));
    installFakeDesktopApi({ gitGetCommitDiff: gitGetCommitDiff as any });

    await useGitStore.getState().gitOpenCommitFileDiff('abc123', 'src/a.ts', 'a.ts', '/nested-repo');

    expect(gitGetCommitDiff).toHaveBeenCalledWith('/nested-repo', 'abc123', 'src/a.ts');
  });

  it('gitDiscoverRepos returns the discovered repo list', async () => {
    const repos = [{ path: '/repo/a', name: 'a' }, { path: '/repo/b', name: 'b' }];
    const gitDiscoverRepos = vi.fn(async () => repos);
    installFakeDesktopApi({ gitDiscoverRepos: gitDiscoverRepos as any });

    const result = await useGitStore.getState().gitDiscoverRepos('/repo');

    expect(gitDiscoverRepos).toHaveBeenCalledWith('/repo');
    expect(result).toEqual(repos);
  });

  it('gitDiscoverRepos returns an empty array (not a throw) when the api call fails', async () => {
    installFakeDesktopApi({ gitDiscoverRepos: vi.fn(async () => { throw new Error('boom'); }) as any });

    const result = await useGitStore.getState().gitDiscoverRepos('/repo');

    expect(result).toEqual([]);
  });

  it('gitFetchCommitGraph fetches from the given dir without touching global gitGraphCommits state', async () => {
    const page = [{ hash: 'a', shortHash: 'a', message: 'm', author: 'x', date: 'd', refs: '', parents: [] }];
    const gitGetCommitGraph = vi.fn(async () => page);
    installFakeDesktopApi({ gitGetCommitGraph: gitGetCommitGraph as any });

    const result = await useGitStore.getState().gitFetchCommitGraph('/nested-repo', 25, 0);

    expect(gitGetCommitGraph).toHaveBeenCalledWith('/nested-repo', 25, 0);
    expect(result).toEqual(page);
    expect(useGitStore.getState().gitGraphCommits).toBeNull();
  });

  it('gitFetchCommitFiles fetches from the given dir without touching global commitFiles state', async () => {
    const files = [{ path: 'a.ts', insertions: 1, deletions: 0, statusText: 'Modified' }];
    const gitGetCommitFiles = vi.fn(async () => files);
    installFakeDesktopApi({ gitGetCommitFiles: gitGetCommitFiles as any });

    const result = await useGitStore.getState().gitFetchCommitFiles('/nested-repo', 'abc123');

    expect(gitGetCommitFiles).toHaveBeenCalledWith('/nested-repo', 'abc123');
    expect(result).toEqual(files);
    expect(useGitStore.getState().commitFiles).toBeNull();
  });

  it('resetGitStatus clears gitRepoStatus only', () => {
    useGitStore.setState({ gitRepoStatus: { branch: 'main' } as any, gitBranches: { current: 'main', all: [] } as any });

    useGitStore.getState().resetGitStatus();

    expect(useGitStore.getState().gitRepoStatus).toBeNull();
    expect(useGitStore.getState().gitBranches).toEqual({ current: 'main', all: [] });
  });

  describe('multi-root: explicit dir overrides the active workspace folder', () => {
    it('gitStage targets the explicit dir, not workspacePath, when one is passed', async () => {
      const gitStage = vi.fn(async () => {});
      const gitStatus = vi.fn(async () => ({ branch: 'main' }));
      installFakeDesktopApi({ gitStage: gitStage as any, gitStatus: gitStatus as any });

      await useGitStore.getState().gitStage('src/a.ts', '/other-repo');

      expect(gitStage).toHaveBeenCalledWith('/other-repo', 'src/a.ts');
      expect(gitStatus).toHaveBeenCalledWith('/other-repo'); // the post-stage refresh also targets it
    });

    it('gitCommit falls back to the active workspace folder when no dir is given', async () => {
      const gitCommit = vi.fn(async () => {});
      installFakeDesktopApi({ gitCommit: gitCommit as any });

      await useGitStore.getState().gitCommit('a message');

      expect(gitCommit).toHaveBeenCalledWith('/repo', 'a message');
    });
  });

  describe('loadAllRepoSummaries', () => {
    it('discovers repos across every open folder and fetches each one\'s real status', async () => {
      useWorkspaceStore.setState({
        workspaceFolders: [{ path: '/repo-a', name: 'repo-a' }, { path: '/repo-b', name: 'repo-b' }],
      });
      const gitDiscoverRepos = vi.fn(async (rootDir: string) => [{ path: rootDir, name: rootDir.split('/').pop()! }]);
      const gitStatus = vi.fn(async (dir: string) => ({ branch: dir === '/repo-a' ? 'main' : 'develop', files: dir === '/repo-b' ? [{ isConflict: true }] : [] } as any));
      installFakeDesktopApi({ gitDiscoverRepos: gitDiscoverRepos as any, gitStatus: gitStatus as any });

      await useGitStore.getState().loadAllRepoSummaries();

      expect(gitDiscoverRepos).toHaveBeenCalledWith('/repo-a');
      expect(gitDiscoverRepos).toHaveBeenCalledWith('/repo-b');
      const summaries = useGitStore.getState().repoSummaries;
      expect(summaries).toHaveLength(2);
      expect(summaries.find((s) => s.dir === '/repo-a')?.status.branch).toBe('main');
      expect(summaries.find((s) => s.dir === '/repo-b')?.status.branch).toBe('develop');
    });

    it('dedupes repos discovered under more than one open folder', async () => {
      useWorkspaceStore.setState({
        workspaceFolders: [{ path: '/parent', name: 'parent' }, { path: '/parent/nested', name: 'nested' }],
      });
      const gitDiscoverRepos = vi.fn(async () => [{ path: '/parent/nested', name: 'nested' }]);
      const gitStatus = vi.fn(async () => ({ branch: 'main', files: [] } as any));
      installFakeDesktopApi({ gitDiscoverRepos: gitDiscoverRepos as any, gitStatus: gitStatus as any });

      await useGitStore.getState().loadAllRepoSummaries();

      expect(useGitStore.getState().repoSummaries).toHaveLength(1);
      expect(gitStatus).toHaveBeenCalledTimes(1);
    });

    it('sets an empty list without calling the api when no folders are open', async () => {
      useWorkspaceStore.setState({ workspaceFolders: [] });
      const gitDiscoverRepos = vi.fn(async () => []);
      installFakeDesktopApi({ gitDiscoverRepos: gitDiscoverRepos as any });

      await useGitStore.getState().loadAllRepoSummaries();

      expect(gitDiscoverRepos).not.toHaveBeenCalled();
      expect(useGitStore.getState().repoSummaries).toEqual([]);
    });
  });
});
