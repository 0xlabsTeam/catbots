import { useNodePositions } from './use-node-positions';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Badge, Banner, Button, LayerCard } from '@cloudflare/kumo';
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
import { nodePresentation, nodeVisualCategory, programNodeSize, programPortPosition } from './node-presentation';

export type StrategyGraphProps = Readonly<{
  revision: StrategyRevision;
  onSelectNode(node: StrategyRevision['nodes'][number]): void;
}>; 

const nodeTypes = { strategy: StrategyNodeCard };

export function StrategyGraph({ revision, onSelectNode }: StrategyGraphProps) {
  const instance = useRef<ReactFlowInstance<StrategyFlowNode> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodeLayout = useNodePositions(`legacy:${revision.botId}:${revision.version}`);
  const graph = useMemo(() => { const graph = buildStrategyGraph(revision); return { ...graph, nodes: graph.nodes.map(node => ({ ...node, position: nodeLayout.positions[node.id] ?? node.position })) }; }, [revision, nodeLayout.positions]);
  return (
    <section className="strategy-graph-shell" aria-label={`Strategy flow for ${revision.name}`}>
      <header className="strategy-scope" aria-label="Market scope">
        <div><span>DEX</span><strong>Hyperliquid</strong></div>
        <div><span>Market scope</span><strong>{scopeDescription(revision)}</strong></div>
      <div className="graph-toolbar"><div><Button size="sm" variant="ghost" onClick={() => void instance.current?.fitView({ padding: 0.15 })}>Fit all</Button><Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => void instance.current?.zoomOut()}>−</Button><Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => void instance.current?.zoomIn()}>+</Button><Button size="sm" variant="secondary" onClick={() => void instance.current?.zoomTo(1)}>100%</Button><Button size="sm" variant="secondary" onClick={nodeLayout.reset}>Auto layout</Button></div></div>
      </header>
      <div className="graph-reading-guide"><div className="graph-node-legend" aria-label="Node categories">{[...new Set(graph.nodes.map(node => nodeVisualCategory(node.data.kind, node.data.nodeType)))].map(category => {
        const { label, icon: Icon } = nodePresentation[category];
        return <Badge key={category} variant="secondary" className={`node-category-${category}`}><Icon size={14} aria-hidden="true" />{label}</Badge>;
      })}</div><span>Drag to arrange · Click to inspect · Layout saved on this device.</span></div>
      {nodeLayout.storageError && <Banner variant="alert" title="Layout not saved" description={nodeLayout.storageError} />}
      <div className="strategy-graph">
        <ReactFlow<StrategyFlowNode, Edge>
          key={`${revision.botId}:${revision.version}`}
          nodes={graph.nodes}
          edges={graph.edges.map((edge) => ({ ...edge, label: undefined, className: selectedId === null ? '' : edge.source === selectedId || edge.target === selectedId ? 'graph-edge-focused' : 'graph-edge-muted' }))}
          nodeTypes={nodeTypes}
          nodesDraggable
          nodeDragThreshold={5}
          onNodesChange={nodeLayout.onNodesChange}
          nodesConnectable={false}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.7, maxZoom: 1 }}
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

export function StrategyNodeCard({ data }: NodeProps<StrategyFlowNode>) {
  const category = nodeVisualCategory(data.kind, data.nodeType);
  const { label, icon: Icon } = nodePresentation[category];
  return (
    <LayerCard className={`strategy-node node-category-${category} ${data.showPorts ? 'program-node' : ''}`} style={data.showPorts ? { '--node-core-size': `${programNodeSize.core}px` } as CSSProperties : undefined} aria-label={data.accessibleName} data-testid="strategy-node" data-kind={data.kind} data-category={category}>
      {data.inputPorts.map((port, index) => <Handle key={port} className={data.portTypes?.inputs[port] === 'flow' ? 'program-handle-flow' : ''} type="target" position={Position.Left} id={port} title={`Input: ${port}`} style={{ left: data.showPorts ? (programNodeSize.width - programNodeSize.core) / 2 : undefined, top: data.showPorts ? programPortPosition(index, data.inputPorts.length) : `${((index + 1) / (data.inputPorts.length + 1)) * 100}%` }} />)}
      <div className="strategy-node-heading"><span className="strategy-node-icon"><Icon size={data.showPorts ? 36 : 18} weight="duotone" aria-hidden="true" /></span><Badge variant="secondary" className="strategy-node-kind">{label}</Badge></div>
      <strong title={data.showPorts ? data.title : data.summary}>{data.showPorts ? data.title : data.summary}</strong>
      {data.showPorts && <><p className="program-node-description" title={data.summary}>{data.summary}</p><span className="program-node-category">{label}</span></>}
      {!data.showPorts && <span>{data.title}</span>}
      {data.showPorts && <>{(['inputs', 'outputs'] as const).flatMap(direction => (direction === 'inputs' ? data.inputPorts : data.outputPorts).map((port, index) => {
        const type = data.portTypes?.[direction][port] ?? 'data';
        return <span className={`program-port ${port === 'main' ? 'program-port-main' : ''} program-port-${direction === 'inputs' ? 'input' : 'output'}`} key={`${direction}-${port}`} style={{ top: programPortPosition(index, direction === 'inputs' ? data.inputPorts.length : data.outputPorts.length) - 22 }} title={`${port}: ${type}`}><span>{port}</span><small>{type}</small></span>;
      }))}</>}
      {data.outputPorts.map((port, index) => <Handle key={port} className={data.portTypes?.outputs[port] === 'flow' ? 'program-handle-flow' : ''} type="source" position={Position.Right} id={port} title={`Output: ${port}`} style={{ right: data.showPorts ? (programNodeSize.width - programNodeSize.core) / 2 : undefined, top: data.showPorts ? programPortPosition(index, data.outputPorts.length) : `${((index + 1) / (data.outputPorts.length + 1)) * 100}%` }} />)}
    </LayerCard>
  );
}
