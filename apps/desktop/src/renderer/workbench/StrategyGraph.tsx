import { useMemo, useRef, useState } from 'react';
import { Button, LayerCard } from '@cloudflare/kumo';
import {
  type Edge,
  type ReactFlowInstance,
  Background,
  BackgroundVariant,
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
  const instance = useRef<ReactFlowInstance<StrategyFlowNode> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graph = useMemo(() => buildStrategyGraph(revision), [revision]);
  return (
    <section className="strategy-graph-shell" aria-label={`Strategy flow for ${revision.name}`}>
      <header className="strategy-scope" aria-label="Market scope">
        <div><span>DEX</span><strong>Hyperliquid</strong></div>
        <div><span>Market scope</span><strong>{scopeDescription(revision)}</strong></div>
      <div className="graph-toolbar"><div><Button size="sm" variant="ghost" onClick={() => void instance.current?.fitView({ padding: 0.15 })}>Fit all</Button><Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => void instance.current?.zoomOut()}>−</Button><Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => void instance.current?.zoomIn()}>+</Button><Button size="sm" variant="secondary" onClick={() => void instance.current?.zoomTo(1)}>100%</Button></div></div>
      </header>
      <p className="graph-reading-guide">Start → Check conditions → Combine results → Act · Select a node to inspect its connections. Lines show rules, not live execution.</p>
      <div className="strategy-graph">
        <ReactFlow<StrategyFlowNode, Edge>
          key={`${revision.botId}:${revision.version}`}
          nodes={graph.nodes}
          edges={graph.edges.map((edge) => ({ ...edge, label: undefined, className: selectedId === null ? '' : edge.source === selectedId || edge.target === selectedId ? 'graph-edge-focused' : 'graph-edge-muted' }))}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          onPaneClick={() => setSelectedId(null)}
          defaultViewport={{ x: 24, y: 24, zoom: 1 }}
          colorMode="system"
          onInit={(flow) => { instance.current = flow; }}
          onNodeClick={(_event, selected) => {
            setSelectedId(selected.id);
            const node = revision.nodes.find(({ id }) => id === selected.id);
            if (node !== undefined) onSelectNode(node);
          }}
          minZoom={0.1}
          maxZoom={1.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
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
    <LayerCard className={`strategy-node strategy-node-${data.kind}`} aria-label={data.accessibleName} data-testid="strategy-node" data-kind={data.kind}>
      {data.inputPorts.map((port, index) => <Handle key={port} type="target" position={Position.Left} id={port} title={`Input: ${port}`} style={{ top: `${((index + 1) / (data.inputPorts.length + 1)) * 100}%` }} />)}
      <span className="strategy-node-kind">{data.kind === 'trigger' ? 'Start' : data.kind === 'action' ? 'Action' : data.nodeType.startsWith('combine.') ? 'Logic' : 'Check'}</span>
      <strong title={data.summary}>{data.summary === data.title ? data.title : data.summary}</strong>
      <span>{data.title}</span>
      {data.outputPorts.map((port, index) => <Handle key={port} type="source" position={Position.Right} id={port} title={`Output: ${port}`} style={{ top: `${((index + 1) / (data.outputPorts.length + 1)) * 100}%` }} />)}
    </LayerCard>
  );
}
