import fs from 'fs';
import path from 'path';
import type { CodeGraph, CodeGraphNode, CodeGraphNodeKind, CodeGraphEdge, ImpactReport, ImpactReportEntry } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { IDatabaseService } from '../db';

const SUGGESTED_TEST_CAP = 10;
// Candidate suffixes tried when resolving a `./`/`../` import, mirroring Node/bundler resolution; bare package names and path aliases are dropped, not turned into dangling edges.
const IMPORT_RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

export interface IImpactAnalysisService {
  /** Whole-project graph, DB-only (no fs access) — cheap enough for the spatial canvas to call directly. */
  getGraph(projectId: string): CodeGraph;
  /** Adds an fs-based suggested-tests lookup on top of getGraph, scoped to one file's impact. */
  getImpact(projectId: string, workspacePath: string, filePath: string): ImpactReport;
}

export const IImpactAnalysisService = createServiceIdentifier<IImpactAnalysisService>('impactAnalysisService');

/** Builds a project-wide dependency graph from data indexer.ts already writes to SQLite and derives a per-file impact report from it; route matching and test-suggestion lookup are deliberately heuristic. */
export class ImpactAnalysisService implements IImpactAnalysisService {
  static readonly inject = [IDatabaseService] as const;

  constructor(private readonly databaseService: IDatabaseService) {}

  getGraph(projectId: string): CodeGraph {
    const symbolRows = this.databaseService.getSymbols(projectId);
    const importRows = this.databaseService.getImports(projectId);
    const routeRows = this.databaseService.getRoutes(projectId);
    const callSiteRows = this.databaseService.getFrontendCallSites(projectId);

    const nodes = new Map<string, CodeGraphNode>();
    const ensureNode = (filePath: string, kind: CodeGraphNodeKind) => {
      const existing = nodes.get(filePath);
      if (!existing) {
        nodes.set(filePath, { id: filePath, filePath, kind });
      } else if (existing.kind === 'module' && kind !== 'module') {
        // Upgrade a generic module node once we learn it's actually a route handler or frontend caller.
        existing.kind = kind;
      }
    };

    // Symbols is the broadest source, letting a "leaf" file with no imports/routes/call-sites still show up as a node; a file with zero recognized symbols still won't get one (known gap).
    symbolRows.forEach((sym) => ensureNode(sym.file_path, 'module'));
    importRows.forEach((imp) => ensureNode(imp.file_path, 'module'));
    routeRows.forEach((route) => ensureNode(route.file_path, 'route-handler'));
    callSiteRows.forEach((cs) => ensureNode(cs.file_path, 'frontend-caller'));

    const edges: CodeGraphEdge[] = [];
    let edgeSeq = 0;
    const nodePaths = new Set(nodes.keys());

    // Import edges — relative-path-only resolution (Risk: path aliases and
    // bare package imports won't produce an edge).
    importRows.forEach((imp) => {
      if (!imp.module_name.startsWith('.')) return;
      const importerDir = path.posix.dirname(imp.file_path);
      const resolvedBase = path.posix.normalize(path.posix.join(importerDir, imp.module_name));
      const match = IMPORT_RESOLUTION_SUFFIXES.map((suffix) => `${resolvedBase}${suffix}`).find((candidate) => nodePaths.has(candidate));
      if (match && match !== imp.file_path) {
        ensureNode(imp.file_path, 'module');
        edges.push({ id: `edge_import_${edgeSeq++}`, source: imp.file_path, target: match, kind: 'imports' });
      }
    });

    // Route <-> frontend call-site edges — loose segment-matching, not real routing; dynamic/templated URLs can both mismatch and false-positive.
    routeRows.forEach((route) => {
      const [routeMethod, routePath] = splitPathPattern(route.path_pattern);
      callSiteRows.forEach((cs) => {
        if (cs.method.toLowerCase() !== routeMethod.toLowerCase()) return;
        if (!segmentsMatch(routePath, cs.url_pattern)) return;
        edges.push({ id: `edge_route_${edgeSeq++}`, source: cs.file_path, target: route.file_path, kind: 'calls-route' });
      });
    });

    return { nodes: Array.from(nodes.values()), edges };
  }

  getImpact(projectId: string, workspacePath: string, filePath: string): ImpactReport {
    const graph = this.getGraph(projectId);
    const nodeByPath = new Map(graph.nodes.map((n) => [n.filePath, n]));

    const toEntry = (nodePath: string): ImpactReportEntry | null => {
      const node = nodeByPath.get(nodePath);
      return node ? { filePath: node.filePath, kind: node.kind } : null;
    };

    // Reverse direction: who imports the target, not what the target imports
    // — that's what could actually break if this file changes.
    const directlyImports = dedupeEntries(
      graph.edges
        .filter((e) => e.kind === 'imports' && e.target === filePath)
        .map((e) => toEntry(e.source))
        .filter((e): e is ImpactReportEntry => e !== null),
    );

    const matchesRoute = dedupeEntries(
      graph.edges
        .filter((e) => e.kind === 'calls-route' && (e.source === filePath || e.target === filePath))
        .map((e) => toEntry(e.source === filePath ? e.target : e.source))
        .filter((e): e is ImpactReportEntry => e !== null),
    );

    const suggestedTests = findSuggestedTests(workspacePath, [filePath, ...directlyImports.map((e) => e.filePath)]);

    return { filePath, directlyImports, matchesRoute, suggestedTests };
  }
}

function splitPathPattern(pathPattern: string): [method: string, routePath: string] {
  const spaceIdx = pathPattern.indexOf(' ');
  if (spaceIdx === -1) return ['get', pathPattern];
  return [pathPattern.slice(0, spaceIdx).toLowerCase(), pathPattern.slice(spaceIdx + 1)];
}

function segmentsMatch(routePath: string, callPath: string): boolean {
  const routeSegments = routePath.split('/').filter(Boolean);
  // Strip a query string off the call site's URL before segmenting, so
  // `/api/users?active=true` still matches `/api/users`.
  const callSegments = callPath.split('?')[0].split('/').filter(Boolean);
  if (routeSegments.length === 0 || routeSegments.length !== callSegments.length) return false;
  return routeSegments.every((seg, i) => {
    if (seg.startsWith(':') || (seg.startsWith('[') && seg.endsWith(']'))) return true;
    return seg === callSegments[i];
  });
}

function dedupeEntries(entries: ImpactReportEntry[]): ImpactReportEntry[] {
  const seen = new Map<string, ImpactReportEntry>();
  entries.forEach((e) => seen.set(e.filePath, e));
  return Array.from(seen.values());
}

// Naming-convention test lookup (X.ts -> X.test.ts/X.spec.ts/__tests__ sibling), not real coverage analysis — fs-based since indexer.ts doesn't index this relationship.
function findSuggestedTests(workspacePath: string, relativeFilePaths: string[]): string[] {
  const found = new Set<string>();
  for (const relPath of relativeFilePaths) {
    if (found.size >= SUGGESTED_TEST_CAP) break;
    const ext = path.posix.extname(relPath);
    const base = relPath.slice(0, relPath.length - ext.length);
    const dir = path.posix.dirname(relPath);
    const baseName = path.posix.basename(base);
    const candidates = [`${base}.test${ext}`, `${base}.spec${ext}`, `${dir}/__tests__/${baseName}.test${ext}`];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(workspacePath, candidate))) found.add(candidate);
    }
  }
  return Array.from(found).slice(0, SUGGESTED_TEST_CAP);
}
