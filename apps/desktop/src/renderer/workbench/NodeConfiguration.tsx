import { useState } from 'react';
import { Badge, Banner, Button, Input, Select, Switch, Tabs } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, ChatFlowDraft } from '@catbots/contracts';
import type { FlowRun } from '@catbots/strategy-runtime/node-examples';
import { configFields, editorDefinitions } from './flow-editor-model';
import { runLiveNode, marketCaption } from './live-node-run';
type Node = ChatFlowDraft['document']['nodes'][number];
export function NodeConfiguration({ draft, node, disabled, onSave, onClose, onDebug, initialRun, nodeApi }: {
  nodeApi?: CatbotsDesktopApi['nodes']; initialRun?: FlowRun | null; draft: ChatFlowDraft; node: Node; disabled?: boolean; onSave?: (node: Node) => Promise<void>; onClose(): void; onDebug(run: FlowRun): void;
}) {
  const def = editorDefinitions.get(node.type)!;
  const [config, setConfig] = useState(node.config);
  const [market, setMarket] = useState('ETH-PERP');
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState('');
  const [tab, setTab] = useState('config');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [run, setRun] = useState<FlowRun | null>(initialRun ?? null);
  const dirty = JSON.stringify(config) !== JSON.stringify(node.config);
  const trace = run?.trace.find(item => item.nodeId === node.id);
  const fields = Object.entries(configFields(node.type).properties ?? {});
  const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
  return <aside className="chat-node-inspector" aria-label="Node configuration">
    <header><div><h3>{def.title}</h3><Badge variant="secondary">{def.category}</Badge></div><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></header>
    <p>{node.id} · v{node.version}</p>
    <Input size="base" label="Market" value={market} onChange={event => { setMarket(event.target.value); setRun(null); setSource(''); }} />
    <Button size="sm" loading={running} disabled={dirty || disabled || running} onClick={async () => {
      setTab('data'); setRunning(true); setRun(null); setSource(''); setError('');
      try { const next = await runLiveNode(draft.document, node.id, nodeApi, market); setRun(next.run); onDebug(next.run); setSource(marketCaption(next.snapshot)); }
      catch { setError('Market run failed. Check the market, timeframe and connection. No sample data was used.'); }
      finally { setRunning(false); }
    }}>Run node</Button>
    <Tabs tabs={[{ value: 'config', label: 'Configuration' }, { value: 'data', label: 'Data & debug' }]} value={tab} onValueChange={setTab} />
    {error && <Banner variant="error" title="Node needs attention" description={error} />}
    {tab === 'config' ? <>
      <p>Settings belong to this node. Connected ports supply its input data.</p>
      {fields.length === 0 && <p>No settings required. This node uses its connected inputs or the runtime event.</p>}
      {fields.map(([key, field]) => {
        const value = config[key] ?? field.default;
        const update = (value: unknown) => { setConfig(current => ({ ...current, [key]: value })); setRun(null); };
        return field.enum ? <Select key={key} size="base" label={label(key)} value={String(value ?? '')} onValueChange={value => update(String(value))}>{field.enum.map(value => <Select.Option key={value} value={value}>{value}</Select.Option>)}</Select>
          : field.type === 'boolean' ? <Switch key={key} label={label(key)} checked={value === true} onCheckedChange={update} />
          : <Input key={key} size="base" label={label(key)} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} value={String(value ?? '')} min={field.minimum} max={field.maximum} onChange={event => update(field.type === 'number' || field.type === 'integer' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />;
      })}
      <div className="provider-actions"><Button size="sm" disabled={!dirty || disabled || !onSave} loading={saving} onClick={async () => {
        const parsed = def.config.safeParse(config);
        if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; }
        setSaving(true); setError('');
        try { await onSave?.({ ...node, config: parsed.data as Record<string, unknown> }); }
        catch { setError('Could not save. The flow may have changed; reload the workspace before retrying.'); }
        finally { setSaving(false); }
      }}>Save configuration</Button><Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => { setConfig(node.config); setError(''); }}>Reset</Button></div>
      {dirty && <Badge variant="info">Unsaved changes</Badge>}
      {disabled && <p>Wait for AI to finish before saving changes.</p>}
    </> : <>
      <p>Uses Hyperliquid mainnet prices and closed candles. Account equity is unavailable. Fresh manual state; order proposals are never sent.</p>

      {source && <p>{source}</p>}
      {dirty && <p>Save or reset settings before debugging.</p>}
      {trace && <Badge variant="info">{trace.status} · {run!.trace.length} nodes evaluated</Badge>}
      {(['inputs', 'outputs'] as const).map(direction => <section key={direction}><h4>{direction === 'inputs' ? 'Input data' : 'Output data'}</h4>
        {Object.entries(def[direction]).map(([port, type]) => {
          const wires = draft.document.edges.filter(edge => direction === 'inputs' ? edge.target === node.id && edge.targetPort === port : edge.source === node.id && edge.sourcePort === port);
          const value = trace?.[direction][port];
          return <div className="node-port-detail" key={port}><strong>{label(port)} <Badge variant="secondary">{type}</Badge></strong>
            <p>{wires.map(edge => direction === 'inputs' ? `From ${edge.source} · ${edge.sourcePort}` : `To ${edge.target} · ${edge.targetPort}`).join(', ') || (direction === 'inputs' ? 'No connection' : 'No downstream connection')}</p>
            {value ? <><Badge variant={value.quality === 'ready' ? 'success' : 'info'}>{value.quality}</Badge><pre>{value.quality === 'unavailable' ? value.reason : JSON.stringify(value.value, null, 2)}</pre></> : <p>Not evaluated. Run Debug to inspect this value.</p>}
          </div>;
        })}
        {!Object.keys(def[direction]).length && <p>No {direction}.</p>}
      </section>)}
    </>}
  </aside>;
}
