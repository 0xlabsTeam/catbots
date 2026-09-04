import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { StrategyRevision } from '@catbots/contracts';

type WorkbenchNode = StrategyRevision['nodes'][number];

export type StrategyFlowNodeData = Record<string, unknown> & Readonly<{
  kind: WorkbenchNode['kind'];
  nodeType: string;
  title: string;
  summary: string;
  accessibleName: string;
}>;

export type StrategyFlowNode = Node<StrategyFlowNodeData, 'strategy'>;

export type StrategyGraphModel = Readonly<{
  nodes: StrategyFlowNode[];
  edges: Edge[];
}>;

const columnByKind: Record<WorkbenchNode['kind'], number> = {
  trigger: 0,
  condition: 1,
  action: 2,
};

export function buildStrategyGraph(revision: StrategyRevision): StrategyGraphModel {
  const rows = new Map<WorkbenchNode['kind'], number>();
  const nodes = revision.nodes.map((node): StrategyFlowNode => {
    const row = rows.get(node.kind) ?? 0;
    rows.set(node.kind, row + 1);
    return {
      id: node.id,
      type: 'strategy',
      position: { x: columnByKind[node.kind] * 320, y: row * 150 },
      data: {
        kind: node.kind,
        nodeType: node.type,
        title: node.title,
        summary: node.summary,
        accessibleName: `${node.kind}: ${node.title}. ${node.summary}`,
      },
    };
  });
  const edges = revision.edges.map((edge): Edge => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourcePort,
    target: edge.target,
    targetHandle: edge.targetPort,
    markerEnd: { type: MarkerType.ArrowClosed },
    type: 'smoothstep',
  }));
  return { nodes, edges };
}
