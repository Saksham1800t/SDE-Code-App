/** Shared types for Code Map + AI Impact Analysis, built from SQLite data written by main/services/indexer.ts. */

export type CodeGraphNodeKind = 'module' | 'route-handler' | 'frontend-caller';

export interface CodeGraphNode {
  /** The node's relative file path, also used as its stable id. */
  id: string;
  filePath: string;
  kind: CodeGraphNodeKind;
}

export type CodeGraphEdgeKind = 'imports' | 'calls-route';

export interface CodeGraphEdge {
  id: string;
  /** Node id (file path) of the file the edge originates from. */
  source: string;
  /** Node id (file path) of the file the edge points to. */
  target: string;
  kind: CodeGraphEdgeKind;
}

export interface CodeGraph {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

export interface ImpactReportEntry {
  filePath: string;
  kind: CodeGraphNodeKind;
}

export interface ImpactReport {
  filePath: string;
  /** Files that directly import the target (reverse of the `imports` edge direction) — i.e. what could break if it changes. */
  directlyImports: ImpactReportEntry[];
  /** Files linked to the target via a route/fetch-URL match, in either direction (target may be handler or caller). */
  matchesRoute: ImpactReportEntry[];
  /** Test file paths found via naming convention (X.ts -> X.test.ts etc.) for the target and its importers — not real coverage data. */
  suggestedTests: string[];
}

/** No window/event resolution needed for either channel — both go through the normal typed registrar/invoker factory. */
export type CodeMapIpcContract = {
  'codemap:getGraph': (projectId: string) => Promise<CodeGraph>;
  'codemap:getImpact': (projectId: string, workspacePath: string, filePath: string) => Promise<ImpactReport>;
};
