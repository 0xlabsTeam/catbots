import { NodeValue } from './NodeValue';
import { useState } from 'react';
import { Badge, Banner, Button, Input, Select, Switch, Tabs } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, ChatFlowDraft } from '@catbots/contracts';
import type { FlowRun } from '@catbots/strategy-runtime/node-examples';
import { configFields, editorDefinitions } from './flow-editor-model';
import { flowDocumentKey, useFlowWorkspaceState, type FlowWorkspaceState } from './flow-workspace-state';
import { runLiveNode, marketCaption } from './live-node-run';
type Node = ChatFlowDraft['document']['nodes'][number];
export function NodeConfiguration({ draft, node, disabled, onSave, onClose, onDebug, initialRun, nodeApi, workspace: sharedWorkspace }: {
  workspace?: FlowWorkspaceState; nodeApi?: CatbotsDesktopApi['nodes']; initialRun?: FlowRun | null; draft: ChatFlowDraft; node: Node; disabled?: boolean; onSave?: (node: Node) => Promise<void>; onClose(): void; onDebug?(run: FlowRun): void;
}) {
  const def = editorDefinitions.get(node.type)!;
  const localWorkspace = useFlowWorkspaceState();
  const workspace = sharedWorkspace ?? localWorkspace;
  const config = workspace.edits[node.id]?.config ?? node.config;
  const market = workspace.market;
  const running = workspace.running;
  const error = workspace.errors[node.id] ?? '';
  const setError = (value: string) => workspace.setError(node.id, value);
  const [tab, setTab] = useState('config');
  const [saving, setSaving] = useState(false);
  const record = workspace.results[node.id];
  const run = record?.run ?? initialRun ?? null;
  const source = record ? marketCaption(record.snapshot) : '';
  const dirty = JSON.stringify(config) !== JSON.stringify(node.config);
  const conflict = dirty && workspace.edits[node.id]?.base !== JSON.stringify(node.config);
  const anyDirty = draft.document.nodes.some(item => workspace.edits[item.id] && JSON.stringify(workspace.edits[item.id]!.config) !== JSON.stringify(item.config));
  const stale = !!record && (record.documentKey !== flowDocumentKey(draft) || record.run.market !== market || anyDirty);
  const trace = run?.trace.find(item => item.nodeId === node.id);
  const fields = Object.entries(configFields(node.type).properties ?? {});
  const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
  return <aside className="chat-node-inspector" aria-label="Node configuration">
    <header><div><h3>{def.title}</h3><Badge variant="secondary">{def.category}</Badge></div><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></header>
    <p>{node.id} · v{node.version}</p>
    {!sharedWorkspace && <Input size="base" label="Market" value={market} onChange={event => workspace.setMarket(event.target.value)} />}
    {sharedWorkspace && <p>Run market: {market}</p>}
    {conflict && <Banner variant="alert" title="Saved configuration changed" description="Your edits are kept. Review them against the latest flow or Reset before saving." />}
    <Button size="sm" loading={running} disabled={anyDirty || disabled || running} onClick={async () => {
      setTab('data'); workspace.setRunning(true); setError('');
      try { const next = await runLiveNode(draft.document, node.id, nodeApi, market); workspace.record({ ...next, documentKey: flowDocumentKey(draft) }); onDebug?.(next.run); }
      catch { setError('Market run failed. Check the market, timeframe and connection. No sample data was used.'); }
      finally { workspace.setRunning(false); }
    }}>Run node</Button>
    <Tabs tabs={[{ value: 'config', label: 'Configuration' }, { value: 'data', label: 'Data & debug' }]} value={tab} onValueChange={setTab} />
    {error && <Banner variant="error" title="Node needs attention" description={error} />}
    {tab === 'config' ? <>
      <p>Settings belong to this node. Connected ports supply its input data.</p>
      {fields.length === 0 && <p>No settings required. This node uses its connected inputs or the runtime event.</p>}
      {fields.map(([key, field]) => {
        const value = config[key] ?? field.default;
        const update = (value: unknown) => { workspace.edit(node.id, { ...config, [key]: value }, node.config); };
        return field.enum ? <Select key={key} size="base" label={label(key)} value={String(value ?? '')} onValueChange={value => update(String(value))}>{field.enum.map(value => <Select.Option key={value} value={value}>{value}</Select.Option>)}</Select>
          : field.type === 'boolean' ? <Switch key={key} label={label(key)} checked={value === true} onCheckedChange={update} />
          : <Input key={key} size="base" label={label(key)} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} value={String(value ?? '')} min={field.minimum} max={field.maximum} onChange={event => update(field.type === 'number' || field.type === 'integer' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />;
      })}
      <div className="provider-actions"><Button size="sm" disabled={!dirty || conflict || disabled || !onSave} loading={saving} onClick={async () => {
        const parsed = def.config.safeParse(config);
        if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; }
        setSaving(true); setError('');
        try { await onSave?.({ ...node, config: parsed.data as Record<string, unknown> }); workspace.saved(node.id, config); }
        catch { setError('Could not save. The flow may have changed; reload the workspace before retrying.'); }
        finally { setSaving(false); }
      }}>Save configuration</Button><Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => { workspace.reset(node.id); setError(''); }}>Reset</Button></div>
      {dirty && <Badge variant="info">Unsaved changes</Badge>}
      {disabled && <p>Wait for AI to finish before saving changes.</p>}
    </> : <>
      <p>Uses Hyperliquid mainnet prices and closed candles. Account equity is unavailable. Fresh manual state; order proposals are never sent.</p>

      {source && <p>{source}</p>}
      {record && <p>Run ID: {record.run.runId}</p>}
      {anyDirty && <p>Save or reset unsaved node settings before running.</p>}
      {stale && <Banner variant="alert" title="Previous run · stale" description="The market or configuration changed. These values belong to the saved run shown below; run again after saving to refresh." />}
      {trace && <Badge variant="info">{trace.status} · {run!.trace.length} nodes evaluated</Badge>}
      {(['outputs', 'inputs'] as const).map(direction => <section key={direction}><h4>{direction === 'inputs' ? 'Input data' : 'Output data'}</h4>
        {Object.entries(def[direction]).map(([port, type]) => {
          const wires = draft.document.edges.filter(edge => direction === 'inputs' ? edge.target === node.id && edge.targetPort === port : edge.source === node.id && edge.sourcePort === port);
          const value = trace?.[direction][port];
          return <div className="node-port-detail" key={port}><strong>{label(port)} <Badge variant="secondary">{type}</Badge></strong>
            <p>{wires.map(edge => direction === 'inputs' ? `From ${edge.source} · ${edge.sourcePort}` : `To ${edge.target} · ${edge.targetPort}`).join(', ') || (direction === 'inputs' ? 'No connection' : 'No downstream connection')}</p>
            {value ? <><Badge variant={value.quality === 'ready' ? 'success' : 'info'}>{value.quality}</Badge>{value.quality === 'unavailable' ? <p>{value.reason}</p> : <NodeValue value={value.value} />}</> : <p>Not evaluated. Run Debug to inspect this value.</p>}
          </div>;
        })}
        {!Object.keys(def[direction]).length && <p>No {direction}.</p>}
      </section>)}
    </>}
  </aside>;
}
