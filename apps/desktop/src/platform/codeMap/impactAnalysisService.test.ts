import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ImpactAnalysisService } from './impactAnalysisService';
import { DatabaseService } from '../db';
import { FakeLogService } from '../log';

describe('ImpactAnalysisService', () => {
  let tmpDir: string;
  let workspacePath: string;
  let databaseService: DatabaseService;
  let service: ImpactAnalysisService;
  const PROJECT_ID = 'proj1';

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-impact-test-'));
    workspacePath = path.join(tmpDir, 'ws');
    fs.mkdirSync(workspacePath, { recursive: true });

    databaseService = new DatabaseService(new FakeLogService());
    await databaseService.initialize(path.join(tmpDir, 'test.db'));
    service = new ImpactAnalysisService(databaseService);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Fixture: src/api.ts imports src/util.ts (resolvable import edge); a
  // deliberately-unresolvable import of a bare package ('lodash') on
  // src/api.ts too; a backend route on src/routes.ts matching a frontend
  // fetch call site on src/widget.tsx (route/call-site edge).
  const seedFixture = () => {
    // util.ts's own symbol row — realistic, since indexer.ts always records
    // whatever recognized symbols a file has; this is what lets it appear as
    // a graph node its importer (api.ts) can resolve an edge to.
    databaseService.run(
      'INSERT INTO symbols (id, project_id, file_path, name, kind, line_number, column_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['sym1', PROJECT_ID, 'src/util.ts', 'helper', 'function', 1, 1],
    );
    databaseService.run(
      'INSERT INTO imports (id, project_id, file_path, module_name, imported_symbols) VALUES (?, ?, ?, ?, ?)',
      ['imp1', PROJECT_ID, 'src/api.ts', './util', '["helper"]'],
    );
    databaseService.run(
      'INSERT INTO imports (id, project_id, file_path, module_name, imported_symbols) VALUES (?, ?, ?, ?, ?)',
      ['imp2', PROJECT_ID, 'src/api.ts', 'lodash', '["debounce"]'],
    );
    databaseService.run(
      'INSERT INTO routes (id, project_id, path_pattern, handler, file_path) VALUES (?, ?, ?, ?, ?)',
      ['route1', PROJECT_ID, 'GET /api/users/:id', 'getUser', 'src/routes.ts'],
    );
    databaseService.run(
      'INSERT INTO frontend_call_sites (id, project_id, file_path, method, url_pattern, caller_symbol, line_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['cs1', PROJECT_ID, 'src/widget.tsx', 'get', '/api/users/42', 'Widget', 5],
    );
  };

  it('getGraph resolves a relative import into an edge, and drops a bare-package import instead of a dangling edge', () => {
    seedFixture();
    const graph = service.getGraph(PROJECT_ID);

    const importEdges = graph.edges.filter((e) => e.kind === 'imports');
    expect(importEdges).toHaveLength(1);
    expect(importEdges[0]).toMatchObject({ source: 'src/api.ts', target: 'src/util.ts' });

    // 'lodash' never produces an edge — util.ts isn't a known node from it,
    // and no dangling node/edge should be fabricated for the bare specifier.
    expect(graph.nodes.some((n) => n.filePath === 'lodash')).toBe(false);
  });

  it('getGraph segment-matches a wildcard route against a frontend call site, same method', () => {
    seedFixture();
    const graph = service.getGraph(PROJECT_ID);

    const routeEdges = graph.edges.filter((e) => e.kind === 'calls-route');
    expect(routeEdges).toHaveLength(1);
    expect(routeEdges[0]).toMatchObject({ source: 'src/widget.tsx', target: 'src/routes.ts' });
  });

  it('getGraph does not match a route/call-site pair with different HTTP methods or segment counts', () => {
    databaseService.run(
      'INSERT INTO routes (id, project_id, path_pattern, handler, file_path) VALUES (?, ?, ?, ?, ?)',
      ['route1', PROJECT_ID, 'POST /api/users/:id', 'updateUser', 'src/routes.ts'],
    );
    databaseService.run(
      'INSERT INTO frontend_call_sites (id, project_id, file_path, method, url_pattern, caller_symbol, line_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['cs1', PROJECT_ID, 'src/widget.tsx', 'get', '/api/users/42', 'Widget', 5],
    );
    databaseService.run(
      'INSERT INTO frontend_call_sites (id, project_id, file_path, method, url_pattern, caller_symbol, line_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['cs2', PROJECT_ID, 'src/other.tsx', 'post', '/api/users/42/extra', 'Other', 5],
    );

    const graph = service.getGraph(PROJECT_ID);
    expect(graph.edges.filter((e) => e.kind === 'calls-route')).toHaveLength(0);
  });

  it('getImpact reports files that import the target (reverse direction), not what the target itself imports', () => {
    seedFixture();
    const impact = service.getImpact(PROJECT_ID, workspacePath, 'src/util.ts');
    expect(impact.directlyImports).toEqual([{ filePath: 'src/api.ts', kind: 'module' }]);

    // The reverse: util.ts's own impact report should NOT include itself,
    // and api.ts's report (nothing imports api.ts) should be empty.
    const apiImpact = service.getImpact(PROJECT_ID, workspacePath, 'src/api.ts');
    expect(apiImpact.directlyImports).toEqual([]);
  });

  it('getImpact groups route/call-site matches bidirectionally under matchesRoute', () => {
    seedFixture();
    const routeImpact = service.getImpact(PROJECT_ID, workspacePath, 'src/routes.ts');
    expect(routeImpact.matchesRoute).toEqual([{ filePath: 'src/widget.tsx', kind: 'frontend-caller' }]);

    const callerImpact = service.getImpact(PROJECT_ID, workspacePath, 'src/widget.tsx');
    expect(callerImpact.matchesRoute).toEqual([{ filePath: 'src/routes.ts', kind: 'route-handler' }]);
  });

  it('getImpact finds a sibling .test.ts file via naming convention, and finds nothing for a file with no test sibling', () => {
    seedFixture();
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'src', 'util.test.ts'), '');
    fs.writeFileSync(path.join(workspacePath, 'src', 'api.ts'), '');

    const impact = service.getImpact(PROJECT_ID, workspacePath, 'src/util.ts');
    // util.ts's own suggested test, plus api.ts's (its direct importer) —
    // api.ts has no test sibling on disk, so only util.test.ts shows up.
    expect(impact.suggestedTests).toEqual(['src/util.test.ts']);

    const noTestImpact = service.getImpact(PROJECT_ID, workspacePath, 'src/routes.ts');
    expect(noTestImpact.suggestedTests).toEqual([]);
  });
});
