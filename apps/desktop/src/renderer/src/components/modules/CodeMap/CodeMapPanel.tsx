import React, { useEffect, useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useReactFlow, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './CodeMapPanel.css';
import type { CodeGraph, CodeGraphNodeKind } from '@sde-code/protocol';
import { useWorkspaceStore } from '../../../store/workspace';
import { useCodeMapStore } from '../../../store/codeMapStore';
import { useTerminalStore } from '../../../store/terminal';
import { toAbsolutePath } from '../../../utils/codeMapImpact';

const COLUMN_ORDER: CodeGraphNodeKind[] = ['frontend-caller', 'module', 'route-handler'];
const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 70;

const KIND_LABEL: Record<CodeGraphNodeKind, string> = {
  'frontend-caller': 'Frontend',
  module: 'Module',
  'route-handler': 'Route Handler',
};

function layoutGraph(graph: CodeGraph): { nodes: Node[]; edges: Edge[] } {
  const rowByKind: Partial<Record<CodeGraphNodeKind, number>> = {};
  const nodes: Node[] = graph.nodes.map((n) => {
    const col = Math.max(0, COLUMN_ORDER.indexOf(n.kind));
    const row = rowByKind[n.kind] ?? 0;
    rowByKind[n.kind] = row + 1;
    return {
      id: n.id,
      position: { x: col * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      data: { label: n.filePath.split('/').pop() || n.filePath },
      className: `sde-codemap-node sde-codemap-node--${n.kind}`,
    };
  });
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.kind === 'calls-route',
    className: `sde-codemap-edge sde-codemap-edge--${e.kind}`,
  }));
  return { nodes, edges };
}

const CodeMapCanvas: React.FC = () => {
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const pendingCanvasFocusPath = useCodeMapStore((s) => s.pendingCanvasFocusPath);
  const clearCanvasFocus = useCodeMapStore((s) => s.clearCanvasFocus);
  const [graph, setGraph] = useState<CodeGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const reactFlow = useReactFlow();

  // getCodeGraph only takes one projectId, so a multi-root workspace shows just the primary folder's graph.
  const primaryFolder = workspaceFolders[0];

  useEffect(() => {
    if (!primaryFolder || !window.api?.getCodeGraph) {
      setGraph(null);
      return;
    }
    setIsLoading(true);
    const projectId = primaryFolder.name || 'default_proj';
    window.api
      .getCodeGraph(projectId)
      .then(setGraph)
      .catch((err) => {
        console.error('Failed to load code graph:', err);
        setGraph(null);
      })
      .finally(() => setIsLoading(false));
  }, [primaryFolder?.path]);

  const { nodes, edges } = useMemo(() => (graph ? layoutGraph(graph) : { nodes: [], edges: [] }), [graph]);

  useEffect(() => {
    if (!pendingCanvasFocusPath || !primaryFolder || nodes.length === 0) return;
    const relPath = pendingCanvasFocusPath.slice(primaryFolder.path.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
    const match = nodes.find((n) => n.id === relPath);
    if (match) {
      reactFlow.fitView({ nodes: [{ id: match.id }], duration: 400, maxZoom: 1.2 });
    }
    clearCanvasFocus();
  }, [pendingCanvasFocusPath, nodes, primaryFolder, reactFlow, clearCanvasFocus]);

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    if (!primaryFolder) return;
    const absPath = toAbsolutePath(node.id, primaryFolder);
    useCodeMapStore.getState().setImpactTarget(absPath);
    useTerminalStore.getState().openPanelTab('impact-report');
  };

  const handleNodeDoubleClick = (_event: React.MouseEvent, node: Node) => {
    if (!primaryFolder) return;
    const absPath = toAbsolutePath(node.id, primaryFolder);
    openFile(absPath, node.id.split('/').pop() || node.id);
  };

  if (!primaryFolder) {
    return <div className="sde-codemap-placeholder">Open a folder to see its Code Map.</div>;
  }
  if (isLoading) {
    return <div className="sde-codemap-placeholder">Loading Code Map...</div>;
  }
  if (!graph || nodes.length === 0) {
    return <div className="sde-codemap-placeholder">Nothing indexed yet for this workspace — open a file or wait for indexing to finish.</div>;
  }

  return (
    <div className="sde-codemap-canvas">
      <ReactFlow nodes={nodes} edges={edges} onNodeClick={handleNodeClick} onNodeDoubleClick={handleNodeDoubleClick} fitView minZoom={0.2} maxZoom={2}>
        <Background />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          position="top-right"
          style={{ width: 90, height: 60 }}
          bgColor="var(--bg-tertiary)"
          nodeColor="var(--text-muted)"
          nodeStrokeColor="var(--border-color)"
          maskColor="rgba(0, 0, 0, 0.35)"
        />
      </ReactFlow>
      <div className="sde-codemap-legend">
        <span className="sde-codemap-legend-hint">Click a node for its Impact Report · double-click to open the file</span>
        <div className="sde-codemap-legend-items">
          {COLUMN_ORDER.map((kind) => (
            <span key={kind} className={`sde-codemap-legend-item sde-codemap-legend-item--${kind}`}>
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export const CodeMapPanel: React.FC = () => (
  <ReactFlowProvider>
    <CodeMapCanvas />
  </ReactFlowProvider>
);
