import { readableRule } from './graph-model';
import { NodeDetailLayout } from './NodeDetailLayout';
import { NodeDataPanel, type DataPort } from './NodeDataPanel';
import { useState } from 'react';
import { Badge, Banner, Button, Input, Select, Switch } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, StrategyRevision } from '@catbots/contracts';
import { loadMarket, marketCaption } from './live-node-run';
import { runLegacyNode } from './legacy-node-run';
type Node = StrategyRevision['nodes'][number];
function leaves(value: Record<string, unknown>, path: string[] = []): { path: string[]; value: unknown }[] {
  return Object.entries(value).flatMap(([key, child]) => child !== null && typeof child === 'object' && !Array.isArray(child)
    ? leaves(child as Record<string, unknown>, [...path, key]) : [{ path: [...path, key], value: child }]);
}
const names: Record<string, string> = { 'left.ref': 'Left · data source', 'left.field': 'Left · field', 'left.literal': 'Left · fixed value', 'right.ref': 'Right · data source', 'right.field': 'Right · field', 'right.literal': 'Right · fixed value', operator: 'Comparison', every: 'Run every', alignment: 'Time alignment', state: 'Position state', side: 'Side', 'size.value': 'Position size', 'size.type': 'Size unit', leverage: 'Leverage' };
const operators: Record<string, string> = { eq: 'Equals (=)', neq: 'Does not equal (≠)', gt: 'Greater than (>)', gte: 'At least (≥)', lt: 'Less than (<)', lte: 'At most (≤)' };
export function LegacyNodeConfiguration({ node, revision, disabled, onSave, nodeApi, onClose }: {
  onClose?(): void; nodeApi?: CatbotsDesktopApi['nodes']; node: Node; revision: StrategyRevision; disabled?: boolean; onSave?: (config: Record<string, unknown>) => Promise<void>;
}) {
  const [config, setConfig] = useState(node.config ?? {});
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [market, setMarket] = useState('ETH-PERP');
  const [result, setResult] = useState<ReturnType<typeof runLegacyNode> | null>(null);
  const [eventType, setEventType] = useState('');
  const [payload, setPayload] = useState('{}');
  const dirty = JSON.stringify(config) !== JSON.stringify(node.config ?? {});
  const update = (path: string[], value: unknown) => {
    const next = structuredClone(config); let parent = next;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    parent[path.at(-1)!] = value; setConfig(next); setResult(null);
  };
  const ports = (direction: 'inputs' | 'outputs'): DataPort[] => [{ name: direction === 'inputs' ? 'input' : 'output', type: 'json', value: result ? { type: 'json', quality: 'ready', value: result.selected[direction] } : undefined, connections: revision.edges.filter(edge => direction === 'inputs' ? edge.target === node.id : edge.source === node.id).map(edge => ({ nodeId: direction === 'inputs' ? edge.source : edge.target, label: direction === 'inputs' ? edge.source : edge.target, port: direction === 'inputs' ? edge.sourcePort : edge.targetPort })) }];
  return <NodeDetailLayout header={<header className="node-detail-header"><div><h2>{node.title}</h2><Badge variant="secondary">{node.kind === 'trigger' ? 'Trigger' : 'Action'}</Badge><Badge variant="secondary">Legacy v{revision.version}</Badge></div><Button size="sm" variant="ghost" onClick={onClose}>Back to canvas</Button></header>}
    input={<NodeDataPanel direction="input" ports={ports('inputs')} />}
    output={<NodeDataPanel direction="output" ports={ports('outputs')} />}
    parameters={<div className="legacy-node-config node-parameter-fields"><h3>Parameters</h3><p>{readableRule(node.summary)}</p>    <Button size="sm" loading={running} disabled={running || dirty || disabled || !node.config || !market.trim()} onClick={async () => {
 setResult(null); setError(''); setSource(''); setRunning(true);
      try {
        const value = JSON.parse(payload);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Test payload must be a JSON object.');
        const snapshot = await loadMarket(nodeApi, market.trim());
        setResult(runLegacyNode(revision, node.id, market.trim(), eventType, value, snapshot)); setSource(marketCaption(snapshot));
      } catch { setError('Market run failed. No sample data was used.'); } finally { setRunning(false); }
    }}>Execute step</Button>
{error && <Banner variant="error" title="Node needs attention" description={error} />}
      <p>Save creates a new draft revision. Existing approval and running deployments keep their original settings.</p>
      {!node.config && <p>Reload this workspace to load editable configuration.</p>}
      {leaves(config).map(({ path, value }) => {
        const key = path.join('.'); const label = names[key] ?? key.replaceAll('.', ' · ').replace(/([a-z])([A-Z])/g, '$1 $2');
        return key === 'operator' ? <Select key={key} label={label} size="base" value={String(value)} onValueChange={value => update(path, value)}>{Object.entries(operators).map(([value, label]) => <Select.Option key={value} value={value}>{label}</Select.Option>)}</Select>
          : typeof value === 'boolean' ? <Switch key={key} label={label} checked={value} onCheckedChange={value => update(path, value)} />
          : <Input key={key} label={label} size="base" type={typeof value === 'number' ? 'number' : 'text'} value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')} onChange={event => {
            if (typeof value === 'object') { try { update(path, JSON.parse(event.target.value)); } catch { setError('This field requires valid JSON.'); } }
            else update(path, typeof value === 'number' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value);
          }} />;
      })}
      {!leaves(config).length && node.config && <p>No settings required; this node uses its connected conditions.</p>}
      <Button size="sm" disabled={!dirty || disabled || !onSave} loading={saving} onClick={async () => {
        setSaving(true); setError('');
        try { await onSave?.(config); } catch { setError('Check the settings. If the revision changed, reload before saving again.'); }
        finally { setSaving(false); }
      }}>Save as new draft</Button>
      <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => { setConfig(node.config ?? {}); setError(''); }}>Reset changes</Button>
<section className="node-run-context"><h4>Run context</h4>      <Input size="base" label="Market" value={market} onChange={event => { setMarket(event.target.value); setResult(null); }} />
      <p>Hyperliquid mainnet mark price and funding. Account data and unsupported indicators remain unavailable. Interval triggers are activated manually (the fetched time is recorded); test events are manual inputs. No orders or state changes are dispatched.</p>
      {revision.nodes.some(item => item.type === 'trigger.event') && <>
        <Input size="base" label="Test event type" value={eventType} onChange={event => { setEventType(event.target.value); setResult(null); }} />
        <Input size="base" label="Test event payload (JSON)" value={payload} onChange={event => { setPayload(event.target.value); setResult(null); }} />
      </>}
      {dirty && <p>Save or reset settings before running.</p>}
      {source && <p>{source}</p>}
{result && <><Badge variant="info">{result.selected.status}</Badge><p>{result.trace.length} nodes evaluated · {result.market}</p></>}</section></div>} />;
}
