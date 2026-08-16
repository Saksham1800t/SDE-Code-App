import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useAgentStore } from './agent';
import { useWorkspaceStore } from './workspace';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.setState(useAgentStore.getInitialState());
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
    installFakeDesktopApi();
  });

  it('setActiveAIProvider updates state and persists the setting', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useAgentStore.getState().setActiveAIProvider('anthropic');

    expect(useAgentStore.getState().activeAIProvider).toBe('anthropic');
    expect(setSetting).toHaveBeenCalledWith('ide-ai-provider', 'anthropic');
  });

  it('setActiveAIModel updates state and persists the setting', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useAgentStore.getState().setActiveAIModel('claude-opus-4-8');

    expect(useAgentStore.getState().activeAIModel).toBe('claude-opus-4-8');
    expect(setSetting).toHaveBeenCalledWith('ide-ai-model', 'claude-opus-4-8');
  });

  it('setInlineCompletionEnabled persists "1"/"0" strings, not booleans', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    useAgentStore.getState().setInlineCompletionEnabled(false);

    expect(useAgentStore.getState().inlineCompletionEnabled).toBe(false);
    expect(setSetting).toHaveBeenCalledWith('ide-inline-completion-enabled', '0');
  });

  it('applyPendingAIEdits clears the pending edit and saves the tab', () => {
    const saveTab = vi.fn();
    useWorkspaceStore.setState({ saveTab });
    useAgentStore.setState({
      pendingAIEdits: { filePath: '/a.ts', originalContent: 'old', currentContent: 'new' },
    });

    useAgentStore.getState().applyPendingAIEdits();

    expect(useAgentStore.getState().pendingAIEdits).toBeNull();
    expect(saveTab).toHaveBeenCalledWith('/a.ts');
  });

  it('discardPendingAIEdits reverts tab content and clears the dirty flag', () => {
    const tab = { path: '/a.ts', name: 'a.ts', content: 'new', isDirty: true } as any;
    useWorkspaceStore.setState({
      groups: [{ id: 'group_test', tabs: [tab], activeTabPath: '/a.ts', editorInstance: null }],
      activeGroupId: 'group_test',
      openTabs: [tab],
      activeTabPath: '/a.ts',
    });
    useAgentStore.setState({
      pendingAIEdits: { filePath: '/a.ts', originalContent: 'old', currentContent: 'new' },
    });

    useAgentStore.getState().discardPendingAIEdits();

    expect(useWorkspaceStore.getState().openTabs[0].content).toBe('old');
    expect(useWorkspaceStore.getState().openTabs[0].isDirty).toBe(false);
    expect(useAgentStore.getState().pendingAIEdits).toBeNull();
  });

  it('setAgentWorkingSet keys changes by filePath', () => {
    useAgentStore.getState().setAgentWorkingSet([
      { filePath: '/a.ts', proposedContent: 'x', originalContent: '', isNew: false, isDeleted: false } as any,
      { filePath: '/b.ts', proposedContent: 'y', originalContent: '', isNew: true, isDeleted: false } as any,
    ]);

    const set = useAgentStore.getState().agentWorkingSet;
    expect(Object.keys(set).sort()).toEqual(['/a.ts', '/b.ts']);
  });

  it('acceptAgentFileChange writes the file, updates an open tab, and removes it from the working set', async () => {
    const writeFile = vi.fn(async () => {});
    installFakeDesktopApi({ writeFile: writeFile as any });
    const tab = { path: '/a.ts', name: 'a.ts', content: 'old', isDirty: false } as any;
    useWorkspaceStore.setState({
      groups: [{ id: 'group_test', tabs: [tab], activeTabPath: '/a.ts', editorInstance: null }],
      activeGroupId: 'group_test',
      openTabs: [tab],
      activeTabPath: '/a.ts',
    });
    useAgentStore.getState().setAgentWorkingSet([
      { filePath: '/a.ts', proposedContent: 'new', originalContent: 'old', isNew: false, isDeleted: false } as any,
    ]);

    await useAgentStore.getState().acceptAgentFileChange('/a.ts');

    expect(writeFile).toHaveBeenCalledWith('/a.ts', 'new');
    expect(useWorkspaceStore.getState().openTabs[0].content).toBe('new');
    expect(useAgentStore.getState().agentWorkingSet).toEqual({});
  });

  it('acceptAgentFileChange deletes the file and closes its tab when the change is a deletion', async () => {
    const deleteFile = vi.fn(async () => {});
    const closeFile = vi.fn();
    const refreshFileTree = vi.fn(async () => {});
    installFakeDesktopApi({ deleteFile: deleteFile as any });
    useWorkspaceStore.setState({ closeFile, refreshFileTree });
    useAgentStore.getState().setAgentWorkingSet([
      { filePath: '/a.ts', proposedContent: '', originalContent: 'old', isNew: false, isDeleted: true } as any,
    ]);

    await useAgentStore.getState().acceptAgentFileChange('/a.ts');

    expect(deleteFile).toHaveBeenCalledWith('/a.ts');
    expect(closeFile).toHaveBeenCalledWith('/a.ts', { skipUnsavedCheck: true });
    expect(refreshFileTree).toHaveBeenCalled();
  });

  it('rejectAgentFileChange reverts an open tab and removes the change without touching disk', () => {
    const tab = { path: '/a.ts', name: 'a.ts', content: 'new', isDirty: true } as any;
    useWorkspaceStore.setState({
      groups: [{ id: 'group_test', tabs: [tab], activeTabPath: '/a.ts', editorInstance: null }],
      activeGroupId: 'group_test',
      openTabs: [tab],
      activeTabPath: '/a.ts',
    });
    useAgentStore.getState().setAgentWorkingSet([
      { filePath: '/a.ts', proposedContent: 'new', originalContent: 'old', isNew: false, isDeleted: false } as any,
    ]);

    useAgentStore.getState().rejectAgentFileChange('/a.ts');

    expect(useWorkspaceStore.getState().openTabs[0].content).toBe('old');
    expect(useWorkspaceStore.getState().openTabs[0].isDirty).toBe(false);
    expect(useAgentStore.getState().agentWorkingSet).toEqual({});
  });

  it('setPendingAIEdits asynchronously populates impact once the owning workspace folder is known (Phase 39)', async () => {
    useWorkspaceStore.setState({ workspaceFolders: [{ path: '/ws', name: 'ws' }] });
    const getImpact = vi.fn(async () => ({
      filePath: 'a.ts',
      directlyImports: [{ filePath: 'b.ts', kind: 'module' }],
      matchesRoute: [],
      suggestedTests: [],
    }));
    installFakeDesktopApi({ getImpact: getImpact as any });

    useAgentStore.getState().setPendingAIEdits({ filePath: '/ws/a.ts', originalContent: 'old', currentContent: 'new' });
    expect(useAgentStore.getState().pendingAIEdits?.impact).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getImpact).toHaveBeenCalledWith('ws', '/ws', 'a.ts');
    expect(useAgentStore.getState().pendingAIEdits?.impact?.directlyImports).toEqual([{ filePath: 'b.ts', kind: 'module' }]);
  });

  it('setAgentWorkingSet asynchronously populates agentWorkingSetImpact per file, and accept/reject clears that file\'s entry (Phase 39)', async () => {
    useWorkspaceStore.setState({ workspaceFolders: [{ path: '/ws', name: 'ws' }] });
    installFakeDesktopApi();

    useAgentStore.getState().setAgentWorkingSet([
      { filePath: '/ws/a.ts', proposedContent: 'x', originalContent: '', isNew: false, isDeleted: false } as any,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAgentStore.getState().agentWorkingSetImpact['/ws/a.ts']).toBeDefined();

    await useAgentStore.getState().acceptAgentFileChange('/ws/a.ts');
    expect(useAgentStore.getState().agentWorkingSetImpact['/ws/a.ts']).toBeUndefined();
  });

  it('acceptAllAgentFileChanges/rejectAllAgentFileChanges act on every pending change', async () => {
    const writeFile = vi.fn(async () => {});
    installFakeDesktopApi({ writeFile: writeFile as any });
    useAgentStore.getState().setAgentWorkingSet([
      { filePath: '/a.ts', proposedContent: 'x', originalContent: '', isNew: false, isDeleted: false } as any,
      { filePath: '/b.ts', proposedContent: 'y', originalContent: '', isNew: false, isDeleted: false } as any,
    ]);

    await useAgentStore.getState().acceptAllAgentFileChanges();

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(useAgentStore.getState().agentWorkingSet).toEqual({});
  });
});
