import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StrategyRevision } from '@catbots/contracts';

import { buildStrategyGraph, type StrategyFlowNode } from './graph-model';

export type StrategyGraphProps = Readonly<{
  revision: StrategyRevision;
  onSelectNode(node: StrategyRevision['nodes'][number]): void;
}>; 

const nodeTypes = { strategy: StrategyNodeCard };

export function StrategyGraph({ revision, onSelectNode }: StrategyGraphProps) {
  const graph = useMemo(() => buildStrategyGraph(revision), [revision]);
  return (
    <section className="strategy-graph-shell" aria-label={`Strategy flow for ${revision.name}`}>
      <header className="strategy-scope" aria-label="Market scope">
        <div><span>DEX</span><strong>Hyperliquid</strong></div>
        <div><span>Market scope</span><strong>{scopeDescription(revision)}</strong></div>
      </header>
      <div className="strategy-graph">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodeClick={(_event, selected) => {
            const node = revision.nodes.find(({ id }) => id === selected.id);
            if (node !== undefined) onSelectNode(node);
          }}
          minZoom={0.35}
          maxZoom={1.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Strategy overview" />
        </ReactFlow>
      </div>
    </section>
  );
}

function scopeDescription(revision: StrategyRevision): string {
  if (revision.marketScope.type === 'dex_universe') return 'All active perpetual markets';
  return revision.marketScope.market === undefined
    ? 'Fixed market · unavailable'
    : `Fixed market · ${revision.marketScope.market}`;
}

function StrategyNodeCard({ data }: NodeProps<StrategyFlowNode>) {
  return (
    <div className={`strategy-node strategy-node-${data.kind}`} aria-label={data.accessibleName} data-testid="strategy-node" data-kind={data.kind}>
      {data.kind !== 'trigger' ? <Handle type="target" position={Position.Left} id={data.kind === 'action' ? 'condition' : data.nodeType.startsWith('combine.') ? 'conditions' : 'activation'} /> : null}
      <span className="strategy-node-kind">{data.kind}</span>
      <strong>{data.title}</strong>
      <span>{data.summary}</span>
      {data.kind !== 'action' ? <Handle type="source" position={Position.Right} id={data.kind === 'trigger' ? 'activation' : 'result'} /> : null}
    </div>
  );
}
