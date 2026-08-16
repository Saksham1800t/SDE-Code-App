import { describe, expect, it, vi } from 'vitest';
import { createImpactAnalysisTools } from './impactAnalysisTools';
import type { IImpactAnalysisService } from './impactAnalysisService';

const makeFakeService = (getImpactImpl: IImpactAnalysisService['getImpact']): IImpactAnalysisService => ({
  getGraph: vi.fn(() => ({ nodes: [], edges: [] })),
  getImpact: getImpactImpl,
});

describe('createImpactAnalysisTools', () => {
  it('resolves a relative filePath against the primary workspace folder and derives projectId from its basename', async () => {
    const getImpact = vi.fn(() => ({
      filePath: 'src/util.ts',
      directlyImports: [{ filePath: 'src/api.ts', kind: 'module' as const }],
      matchesRoute: [],
      suggestedTests: ['src/util.test.ts'],
    }));
    const [tool] = createImpactAnalysisTools({
      workspaceFolders: ['/Users/me/my-project'],
      impactAnalysisService: makeFakeService(getImpact),
    });

    const result = await tool.execute({ filePath: 'src/util.ts' });

    expect(getImpact).toHaveBeenCalledWith('my-project', '/Users/me/my-project', 'src/util.ts');
    expect(result).toContain('Directly imported by: src/api.ts');
    expect(result).toContain('Suggested tests: src/util.test.ts');
    expect(result).toContain('heuristic');
  });

  it('rejects a path outside every open workspace folder without calling the impact service', async () => {
    const getImpact = vi.fn();
    const [tool] = createImpactAnalysisTools({
      workspaceFolders: ['/Users/me/my-project'],
      impactAnalysisService: makeFakeService(getImpact),
    });

    const result = await tool.execute({ filePath: '/etc/passwd' });

    expect(getImpact).not.toHaveBeenCalled();
    expect(result).toMatch(/outside/i);
  });

  it('reports no results found, still noting the heuristic caveat, when the impact report is empty', async () => {
    const getImpact = vi.fn(() => ({
      filePath: 'src/isolated.ts',
      directlyImports: [],
      matchesRoute: [],
      suggestedTests: [],
    }));
    const [tool] = createImpactAnalysisTools({
      workspaceFolders: ['/Users/me/my-project'],
      impactAnalysisService: makeFakeService(getImpact),
    });

    const result = await tool.execute({ filePath: 'src/isolated.ts' });

    expect(result).toMatch(/no indexed dependents/i);
  });

  it('returns a message instead of calling the service when no filePath is provided', async () => {
    const getImpact = vi.fn();
    const [tool] = createImpactAnalysisTools({
      workspaceFolders: ['/Users/me/my-project'],
      impactAnalysisService: makeFakeService(getImpact),
    });

    const result = await tool.execute({});

    expect(getImpact).not.toHaveBeenCalled();
    expect(result).toMatch(/no filepath/i);
  });
});
