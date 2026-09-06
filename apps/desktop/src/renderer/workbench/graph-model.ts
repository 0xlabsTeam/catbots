import { graphlib, layout } from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { StrategyRevision } from '@catbots/contracts';

type WorkbenchNode = StrategyRevision['nodes'][number];

export type StrategyFlowNodeData = Record<string, unknown> & Readonly<{
  kind: string;
  nodeType: string;
  title: string;
  summary: string;
  accessibleName: string;
  inputPorts: string[];
  outputPorts: string[];
  showPorts?: boolean;
  portTypes?: { inputs: Record<string, string>; outputs: Record<string, string> };
}>;

export type StrategyFlowNode = Node<StrategyFlowNodeData, 'strategy'>;

export type StrategyGraphModel = Readonly<{
  nodes: StrategyFlowNode[];
  edges: Edge[];
}>;

export function readableRule(summary: string): string {
  return summary
    .replace(/indicator\.rsi\.(\d+)(?:\.value)?/g, 'RSI ($1)')
    .replace(/market\.symbol/g, 'Market')
    .replace(/market\.funding(?:\.rate)?/g, 'Funding rate')
    .replace(/market\.price/g, 'Price')
    .replace(/market\.rank(?:\.value)?/g, 'Market rank')
    .replace(/account\.equity/g, 'Account equity');
}

export function nodeLabel(node: WorkbenchNode): string {
  const labels: Record<string, string> = {
    'combine.all': 'All conditions (AND)', 'combine.any': 'Any condition (OR)',
    'combine.not': 'Reverse result (NOT)', 'combine.at_least': 'Minimum matches',
  };
  return labels[node.type] ?? node.title;
}

export function buildStrategyGraph(revision: StrategyRevision): StrategyGraphModel {
  // Dagre orders connected branches together and minimizes crossings between ranks.
  // Fixed card bounds keep routing independent of text wrapping and browser font size.
  const diagram = new graphlib.Graph({ multigraph: true });
  diagram.setGraph({ rankdir: 'LR', ranksep: 160, nodesep: 64, edgesep: 32, marginx: 24, marginy: 24 });
  diagram.setDefaultEdgeLabel(() => ({}));
  for (const node of revision.nodes) diagram.setNode(node.id, { width: 240, height: 112 });
  for (const edge of revision.edges) {
    if (diagram.hasNode(edge.source) && diagram.hasNode(edge.target)) {
      diagram.setEdge(edge.source, edge.target, {}, edge.id);
    }
  }
  layout(diagram);
  const nodes = revision.nodes.map((node): StrategyFlowNode => {
    const position = diagram.node(node.id);
    return {
      id: node.id,
      type: 'strategy',
      position: { x: position.x - 120, y: position.y - 56 },
      width: 240,
      height: 112,
      data: {
        kind: node.kind,
        nodeType: node.type,
        title: nodeLabel(node),
        summary: readableRule(node.summary),
        inputPorts: [...new Set(revision.edges.filter((edge) => edge.target === node.id).map((edge) => edge.targetPort))],
        outputPorts: [...new Set(revision.edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourcePort))],
        accessibleName: `${node.kind}: ${nodeLabel(node)}. ${readableRule(node.summary)}`,
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
    type: 'default',
    ariaLabel: `${edge.source} to ${edge.target}`,
    label: revision.nodes.find((node) => node.id === edge.source)?.kind === 'trigger' ? 'Run' : revision.nodes.find((node) => node.id === edge.target)?.kind === 'action' ? 'If true' : 'Result',
  }));
  return { nodes, edges };
}
