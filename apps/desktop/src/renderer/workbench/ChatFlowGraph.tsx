import { prepareFlow, runtimeNodePackages } from '@catbots/strategy-runtime/node-examples';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Banner, Button, Input } from '@cloudflare/kumo';
import { Background, BackgroundVariant, MarkerType, ReactFlow, type Edge, type ReactFlowInstance } from '@xyflow/react';
import { graphlib, layout } from '@dagrejs/dagre';
import type { CatbotsDesktopApi, ChatFlowDraft } from '@catbots/contracts';
import { StrategyNodeCard } from './StrategyGraph';
import type { StrategyFlowNode } from './graph-model';
import { programNodeSize } from './node-presentation';
import { NodeConfiguration } from './NodeConfiguration';
import { flowDocumentKey, useFlowWorkspaceState, type FlowWorkspaceState } from './flow-workspace-state';
import { editorDefinitions } from './flow-editor-model';
const nodeTypes = { strategy: StrategyNodeCard };
export function ChatFlowGraph({ draft, disabled, onSave, nodeApi, workspace: sharedWorkspace, onValidate }: { draft: ChatFlowDraft; onValidate?: () => Promise<void>; workspace?: FlowWorkspaceState; nodeApi?: CatbotsDesktopApi['nodes']; disabled?: boolean; onSave?: (node: ChatFlowDraft['document']['nodes'][number]) => Promise<void> }) {
  const [validationError, setValidationError] = useState('');
  const [validating, setValidating] = useState(false);
  const positioned = useRef(false);
  const document = draft.document;
  const localWorkspace = useFlowWorkspaceState();
  const workspace = sharedWorkspace ?? localWorkspace;
  const debugRun = workspace.lastRun?.documentKey === flowDocumentKey(draft) && workspace.lastRun.run.market === workspace.market && !Object.keys(workspace.edits).length ? workspace.lastRun.run : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [instance, setInstance] = useState<ReactFlowInstance<StrategyFlowNode> | null>(null);
  const graph = useMemo(() => {
    const diagram = new graphlib.Graph();
    diagram.setGraph({ rankdir: 'LR', ranksep: 96, nodesep: 48, marginx: 20, marginy: 20 });
    diagram.setDefaultEdgeLabel(() => ({}));
    document.nodes.forEach(node => diagram.setNode(node.id, { width: programNodeSize.width, height: programNodeSize.height }));
    document.edges.forEach(edge => diagram.setEdge(edge.source, edge.target));
    layout(diagram);
    const nodes: StrategyFlowNode[] = document.nodes.map(node => {
      const def = editorDefinitions.get(node.type)!;
      const point = diagram.node(node.id);
      return { id: node.id, type: 'strategy', selected: node.id === selected, position: { x: point.x - programNodeSize.width / 2, y: point.y - programNodeSize.height / 2 }, width: programNodeSize.width, height: programNodeSize.height,
        data: { kind: def.category, nodeType: node.type, title: def.title, summary: Object.entries(node.config).slice(0, 3).map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${String(value)}`).join(' · ') || (def.category === 'trigger' ? 'Starts one evaluation' : def.category === 'data' ? 'Reads snapshot data' : def.type === 'condition.branch' ? 'Routes to true or false' : def.category === 'output' ? 'Inspect connected value' : 'Uses connected inputs'), accessibleName: `${def.category}: ${def.title}`, inputPorts: Object.keys(def.inputs), outputPorts: Object.keys(def.outputs), portTypes: { inputs: def.inputs, outputs: def.outputs }, showPorts: true } };
    });
    const edges: Edge[] = document.edges.map((edge, index) => {
      const source = document.nodes.find(node => node.id === edge.source)!;
      const type = editorDefinitions.get(source.type)!.outputs[edge.sourcePort];
      return { id: `wire-${index}`, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, type: 'default', markerEnd: { type: MarkerType.ArrowClosed }, className: type === 'flow' ? 'program-flow-wire' : 'program-data-wire', label: selected === edge.source || selected === edge.target ? `${edge.sourcePort} → ${edge.targetPort}${debugRun?.trace.find(item => item.nodeId === edge.source)?.outputs[edge.sourcePort] ? ' · ' + JSON.stringify(debugRun.trace.find(item => item.nodeId === edge.source)!.outputs[edge.sourcePort]!.value).slice(0, 36) : ''}` : undefined };
    });
    return { nodes, edges };
  }, [document, selected, debugRun]);
  useEffect(() => {
    if (!instance || !graph.nodes.length || positioned.current) return;
    const timer = setTimeout(() => { positioned.current = true; void instance.setViewport({ x: 24 - graph.nodes[0]!.position.x * 0.85, y: 32 - graph.nodes[0]!.position.y * 0.85, zoom: 0.85 }); }, 100);
    return () => clearTimeout(timer);
  }, [instance, document.nodes.length, document.edges.length]);
  const node = document.nodes.find(item => item.id === selected);
  return <section className="strategy-graph-shell" aria-label="AI flow draft">
    <header className="strategy-scope">
      <Badge variant={draft.status === 'valid' ? 'success' : 'info'}>Flow v{draft.version} · {draft.status === 'valid' ? 'Validated' : 'Building'}</Badge>
      {onValidate && <Button size="sm" variant="secondary" loading={validating} disabled={disabled || !!Object.keys(workspace.edits).length || validating} onClick={async () => { setValidating(true); setValidationError(''); try { prepareFlow(document, runtimeNodePackages); await onValidate(); } catch (error) { setValidationError(error instanceof Error ? error.message : 'Check required input connections and settings, then retry.'); } finally { setValidating(false); } }}>Validate flow</Button>}
      <span role="status">{document.nodes.length} nodes · {document.edges.length} connections · Saved</span>
      <Input size="sm" label="Run market" value={workspace.market} onChange={event => workspace.setMarket(event.target.value)} />
      <Button size="sm" variant="secondary" onClick={() => void instance?.fitView({ padding: 0.15, maxZoom: 1 })}>Fit flow</Button>
      <Button size="sm" variant="ghost" onClick={() => void instance?.zoomTo(1)}>100%</Button>
      <Button size="sm" variant="ghost" disabled={!selected} onClick={() => void instance?.fitView({ nodes: graph.nodes.filter(item => item.id === selected), minZoom: 0.75, maxZoom: 1, padding: 0.2 })}>Focus node</Button>
    </header>
    {validationError && <Banner variant="error" title="Flow needs attention" description={validationError} />}
    <div className="graph-reading-guide"><span>AI changes appear here as they are saved. Solid wires activate nodes; dashed wires carry data.</span></div>
    <div className={node ? "chat-flow-layout has-selection" : "chat-flow-layout"}><div className="strategy-graph">
      <ReactFlow<StrategyFlowNode, Edge> nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} onInit={setInstance}
        defaultViewport={{ x: 20, y: 20, zoom: 0.85 }} minZoom={0.1} maxZoom={1.5} colorMode="system"
        nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null}
        onNodeClick={(_, item) => setSelected(item.id)} onPaneClick={() => setSelected(null)}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
    </div>
    {node && <NodeConfiguration key={`${node.id}:${draft.version}`} draft={draft} node={node} nodeApi={nodeApi} disabled={disabled} onSave={onSave} onClose={() => setSelected(null)} workspace={workspace} />}
    </div>
  </section>;
}
