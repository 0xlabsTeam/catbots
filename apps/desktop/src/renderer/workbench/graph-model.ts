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

export function buildStrategyGraph(revision: StrategyRevision): StrategyGraphModel {
  // Longest-path layers keep combining predicates after their inputs, not stacked
  // in one ever-taller condition column. Disconnected nodes retain a stable order.
  const depth = new Map(revision.nodes.map((node) => [node.id, 0]));
  const incoming = new Map(revision.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of revision.edges) {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = revision.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const target of outgoing.get(id) ?? []) {
      depth.set(target, Math.max(depth.get(target)!, depth.get(id)! + 1));
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  const rows = new Map<number, number>();
  const nodes = revision.nodes.map((node): StrategyFlowNode => {
    const column = depth.get(node.id)!;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: node.id,
      type: 'strategy',
      position: { x: column * 320, y: row * 150 },
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
