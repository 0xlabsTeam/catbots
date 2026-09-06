import { useMemo, useRef, useState } from 'react';
import { Badge, Banner, Button, Input, LayerCard, Select, Switch } from '@cloudflare/kumo';
import { Background, BackgroundVariant, MarkerType, ReactFlow, type Edge, type ReactFlowInstance } from '@xyflow/react';
import { graphlib, layout } from '@dagrejs/dagre';
import { evaluatePackagedFlow, prepareFlow, runtimeNodePackages, exampleContext, type FlowDocument, type FlowEdge, type FlowRun } from '@catbots/strategy-runtime/node-examples';
import { runLiveNode, loadMarket, marketCaption } from './live-node-run';
import type { CatbotsDesktopApi } from '@catbots/contracts';
import { StrategyNodeCard } from './StrategyGraph';
import type { StrategyFlowNode } from './graph-model';
import { nodePresentation, programNodeSize } from './node-presentation';
import { configFields, connectionError, defaultConfig, editorDefinitions, parseDraft, starterFlow } from './flow-editor-model';

const nodeTypes = { strategy: StrategyNodeCard };
const storageKey = 'catbots.flow-programming-draft.v1';
function initialDraft() {
  try {
    const saved = localStorage.getItem(storageKey);
    const parsed = saved ? JSON.parse(saved) : null;
    const positions: Record<string, { x: number; y: number }> = {};
    if (parsed?.positions && typeof parsed.positions === 'object') for (const [id, point] of Object.entries(parsed.positions).slice(0, 200)) {
      const value = point as { x?: unknown; y?: unknown };
      if (value && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y)) positions[id] = { x: value.x, y: value.y };
    }
    return { document: parsed ? parseDraft(parsed.document ?? parsed) : starterFlow(), positions, error: '' };
  }
  catch { return { document: starterFlow(), positions: {}, error: 'Saved draft could not be loaded. The starter is shown; your saved draft has not been overwritten.' }; }
}
export function PackageNodeExample({ nodeApi, bots, onOpenBot }: { bots?: CatbotsDesktopApi['bots']; onOpenBot?(bot: import('@catbots/contracts').BotSummary): void; nodeApi?: CatbotsDesktopApi['nodes'] }) {
  const [importBot, setImportBot] = useState<import('@catbots/contracts').BotSummary | null>(null);
  const [botName, setBotName] = useState('Flow from sandbox');
  const [importing, setImporting] = useState(false);
  const [market, setMarket] = useState('ETH-PERP');
  const [running, setRunning] = useState(false);
  const [initial] = useState(initialDraft);
  const [document, setDocument] = useState(initial.document);
  const [selected, setSelected] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(initial.error);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [runIndex, setRunIndex] = useState(0);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(initial.positions);
  const [wireSource, setWireSource] = useState('');
  const [wireTarget, setWireTarget] = useState('');
  const [simulationId, setSimulationId] = useState(() => crypto.randomUUID());
  const flow = useRef<ReactFlowInstance<StrategyFlowNode> | null>(null);
  const edit = (next: FlowDocument) => { setDocument(next); setRuns([]); setRunIndex(0); setSimulationId(crypto.randomUUID()); setNotice('Unsaved changes · run history cleared'); };
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
      return { id: node.id, type: 'strategy', selected: node.id === selected, position: positions[node.id] ?? { x: point.x - programNodeSize.width / 2, y: point.y - programNodeSize.height / 2 }, width: programNodeSize.width, height: programNodeSize.height,
        data: { kind: def.category, nodeType: node.type, title: def.title, summary: Object.entries(node.config).slice(0, 3).map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${String(value)}`).join(' · ') || (def.category === 'trigger' ? 'Starts one evaluation' : def.category === 'data' ? 'Reads snapshot data' : def.type === 'condition.branch' ? 'Routes to true or false' : def.category === 'output' ? 'Inspect connected value' : 'Uses connected inputs'), accessibleName: `${def.category}: ${def.title}`, inputPorts: Object.keys(def.inputs), outputPorts: Object.keys(def.outputs), portTypes: { inputs: def.inputs, outputs: def.outputs }, showPorts: true } };
    });
    const edges: Edge[] = document.edges.map((edge, index) => {
      const source = document.nodes.find(node => node.id === edge.source)!;
      const type = editorDefinitions.get(source.type)!.outputs[edge.sourcePort];
      return { id: `wire-${index}`, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: edge.targetPort, type: 'default', markerEnd: { type: MarkerType.ArrowClosed }, className: type === 'flow' ? 'program-flow-wire' : 'program-data-wire', label: selected === edge.source || selected === edge.target ? `${edge.sourcePort} → ${edge.targetPort}` : undefined };
    });
    return { nodes, edges };
  }, [document, selected, positions]);
  const node = document.nodes.find(node => node.id === selected);
  const definition = node ? editorDefinitions.get(node.type) : undefined;
  const currentRun = runs[runIndex];
  const currentTrace = currentRun?.trace.find(trace => trace.nodeId === selected);
  const connect = (edge: FlowEdge) => { const error = connectionError(document, edge); if (error) setNotice(error); else edit({ ...document, edges: [...document.edges, edge] }); };
  const simulate = async () => {
    setRunning(true);
    try {
      if (runs.length >= 100) throw new Error('100-tick limit reached. Clear run history to continue.');
      const snapshot = await loadMarket(nodeApi, market, [...new Set(document.nodes.filter(node => node.type === 'data.candles').map(node => String(node.config.timeframe)))]);
      const result = evaluatePackagedFlow(document, { deploymentId: simulationId, runId: crypto.randomUUID(), market, at: Date.parse(snapshot.fetchedAt), price: snapshot.price, equity: NaN, candles: snapshot.candles, fills: [], cancelledOrderIds: [] });
      setRuns([...runs, result]); setRunIndex(runs.length); setNotice(`Tick ${runs.length + 1}: ${result.orders.length} order proposals. No orders sent.`);
    } catch { setNotice('Market run failed. No sample data was used.'); } finally { setRunning(false); }
  };
  return <LayerCard className="settings-card package-node-example">
    <header><Button className="palette-toggle" size="sm" variant="secondary" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}>Node palette</Button><h2>Flow sandbox</h2><div className="provider-actions">
      <Button size="sm" variant="secondary" onClick={() => void flow.current?.fitView({ padding: 0.12 })}>Fit flow</Button>
      <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => void flow.current?.zoomIn()}>+</Button>
      <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => void flow.current?.zoomOut()}>−</Button>
      <Button size="sm" variant="secondary" onClick={() => void flow.current?.zoomTo(1)}>100%</Button>
      <Button size="sm" variant="secondary" onClick={() => { setPositions({}); }}>Auto layout</Button>
      <Button size="sm" variant="secondary" onClick={() => { try { localStorage.setItem(storageKey, JSON.stringify({ document, positions })); setNotice('Draft saved in this browser.'); } catch { setNotice('Could not save draft. Browser storage may be full or disabled.'); } }}>Save draft</Button>
      <Button size="sm" loading={running} onClick={simulate}>Run with market data</Button>
    </div></header>
    {bots && nodeApi && <div className="provider-actions"><Input size="sm" label="New bot name" value={botName} disabled={!!importBot || importing} onChange={event => setBotName(event.target.value)} /><Button size="sm" loading={importing} disabled={importing || !botName.trim()} onClick={async () => { setImporting(true); try { if (!document.nodes.length) throw new Error('Add nodes first'); prepareFlow(document, runtimeNodePackages); const created = importBot ?? await bots.createDraft({ name: botName.trim(), dex: 'hyperliquid' }); setImportBot(created); await nodeApi.command({ action: 'import_flow', botId: created.id, document }); onOpenBot?.(created); } catch { setNotice('Import failed. Connect every required input and check node settings, then retry. The sandbox is kept; retry uses the same bot.'); } finally { setImporting(false); } }}>Import into new bot</Button></div>}
    <p>Flow wires activate nodes. Dashed Data wires carry values. Drag between matching ports, or connect them in the inspector. Sandbox drafts are stored only in this browser. Import into a new bot to save to the shared backend and continue in AI chat.</p>
    <Input size="base" label="Market" value={market} onChange={event => { setMarket(event.target.value); setRuns([]); }} /><p>Hyperliquid mainnet · closed candles and mark price · account equity unavailable. Fresh manual state; no orders sent.</p>
    {notice && <Banner variant="default" title="Flow editor" description={notice} />}
    <div className={`flow-program-layout${paletteOpen ? ' palette-open' : ''}`}>
      <section className="flow-program-palette" aria-label="Node palette"><Input size="base" label="Find a node" value={search} onChange={event => setSearch(event.target.value)} />
        {Object.entries(nodePresentation).filter(([category]) => category !== 'logic').map(([category, { label, icon: Icon }]) => {
          const definitions = [...editorDefinitions.values()].filter(def => def.category === category && `${def.title} ${def.type}`.toLowerCase().includes(search.toLowerCase()));
          return definitions.length ? <section key={category}><Badge variant="secondary" className={`node-category-${category}`}><Icon size={14} aria-hidden="true" />{label}</Badge>{definitions.map(def => <Button size="sm" variant="ghost" key={def.type} onClick={() => {
            if (document.nodes.length >= 200) { setNotice('Maximum 200 nodes.'); return; }
            const id = crypto.randomUUID(); edit({ ...document, nodes: [...document.nodes, { id, type: def.type, version: def.version, config: defaultConfig(def.type) }] }); setSelected(id);
          }}>Add {def.title}</Button>)}</section> : null;
        })}
      </section>
      <div className="strategy-graph flow-program-canvas">
        <ReactFlow<StrategyFlowNode, Edge> nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.1} maxZoom={1.5} colorMode="system"
          onInit={instance => { flow.current = instance; }} onNodeClick={(_, node) => { setSelected(node.id); setWireSource(''); setWireTarget(''); }} onPaneClick={() => setSelected(null)}
          onNodesChange={changes => { for (const change of changes) if (change.type === 'position' && change.position) setPositions(current => ({ ...current, [change.id]: change.position! })); }}
          onEdgesChange={changes => { const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id)); if (removed.size) edit({ ...document, edges: document.edges.filter((_, index) => !removed.has(`wire-${index}`)) }); }}
          isValidConnection={connection => !connectionError(document, { source: connection.source, target: connection.target, sourcePort: connection.sourceHandle ?? '', targetPort: connection.targetHandle ?? '' })}
          onConnect={connection => connect({ source: connection.source, target: connection.target, sourcePort: connection.sourceHandle ?? '', targetPort: connection.targetHandle ?? '' })}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        </ReactFlow>
      </div>
      <section className="flow-program-inspector" aria-label="Flow inspector">{node && definition ? <>
        <h3>{definition.title}</h3><p>{definition.packageName}</p>
        {Object.entries(configFields(node.type).properties ?? {}).map(([key, field]) => {
          const value = node.config[key] ?? field.default;
          const update = (value: unknown) => edit({ ...document, nodes: document.nodes.map(item => item.id === node.id ? { ...item, config: { ...item.config, [key]: value } } : item) });
          return field.enum ? <Select size="base" key={key} label={key} value={String(value ?? '')} onValueChange={value => update(String(value))}>{field.enum.map(value => <Select.Option key={value} value={value}>{value}</Select.Option>)}</Select>
            : field.type === 'boolean' ? <Switch key={key} label={key} checked={value === true} onCheckedChange={update} />
            : <Input size="base" key={key} label={key} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} value={String(value ?? '')} min={field.minimum} max={field.maximum} onChange={event => update(field.type === 'number' || field.type === 'integer' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />;
        })}
        <Button size="sm" variant="secondary" loading={running} onClick={async () => { setRunning(true); try {
          const next = await runLiveNode(document, node.id, nodeApi, market); setRuns([next.run]); setRunIndex(0); setNotice(marketCaption(next.snapshot));
        } catch { setRuns([]); setNotice('Market run failed. No sample data was used.'); } finally { setRunning(false); } }}>Run node</Button>
        <h4>Connect an input</h4>
        <Select size="base" label="Target port" value={wireTarget} onValueChange={value => setWireTarget(String(value))}>{Object.entries(definition.inputs).map(([port, type]) => <Select.Option key={port} value={port}>{port} · {type}</Select.Option>)}</Select>
        <Select size="base" label="Source port" value={wireSource} onValueChange={value => setWireSource(String(value))}>{document.nodes.filter(item => item.id !== node.id).flatMap(item => Object.entries(editorDefinitions.get(item.type)!.outputs).filter(([, type]) => type === definition.inputs[wireTarget]).map(([port]) => <Select.Option key={`${item.id}:${port}`} value={JSON.stringify([item.id, port])}>{editorDefinitions.get(item.type)!.title} · {item.id.slice(0, 8)} · {port}</Select.Option>))}</Select>
        <Button size="sm" disabled={!wireTarget || !wireSource} onClick={() => { const [source, sourcePort] = JSON.parse(wireSource); connect({ source, sourcePort, target: node.id, targetPort: wireTarget }); }}>Connect ports</Button>
        <h4>Connections</h4>{document.edges.map((edge, index) => edge.target === node.id || edge.source === node.id ? <Button size="sm" variant="ghost" key={index} onClick={() => edit({ ...document, edges: document.edges.filter((_, i) => i !== index) })}>Remove {edge.sourcePort} → {edge.targetPort}</Button> : null)}
        <Button size="sm" variant="secondary" onClick={() => { edit({ ...document, nodes: document.nodes.filter(item => item.id !== node.id), edges: document.edges.filter(edge => edge.source !== node.id && edge.target !== node.id) }); setSelected(null); }}>Delete node</Button>
        {currentTrace && <><h4>Tick {runIndex + 1} · {currentTrace.status ?? 'executed'}</h4><pre>{JSON.stringify({ inputs: currentTrace.inputs, outputs: currentTrace.outputs }, null, 2)}</pre></>}
      </> : <p>Select a node to configure it and inspect its ports.</p>}</section>
    </div>
    <section aria-label="Flow debugger"><h3>Debug timeline</h3><div className="provider-actions"><Button size="sm" variant="secondary" onClick={() => { setRuns([]); setSimulationId(crypto.randomUUID()); setRunIndex(0); setNotice('Run history cleared.'); }}>Clear run history</Button>{runs.map((run, index) => <Button size="sm" variant={index === runIndex ? 'secondary' : 'ghost'} key={run.runId} onClick={() => setRunIndex(index)}>Tick {index + 1}</Button>)}</div>
      {currentRun ? <><p>{currentRun.orders.length} proposals · {currentRun.market} · {new Date(currentRun.at).toISOString()}</p><div className="flow-trace-list">{currentRun.trace.map(trace => <Button size="sm" variant="ghost" key={trace.nodeId} onClick={() => setSelected(trace.nodeId)}>{editorDefinitions.get(document.nodes.find(node => node.id === trace.nodeId)!.type)!.title} · {trace.status ?? 'executed'}</Button>)}</div></> : <p>Run with market data to inspect node inputs, outputs and skipped branches.</p>}
    </section>
  </LayerCard>;
}
