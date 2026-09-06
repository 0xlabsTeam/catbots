import { useState } from 'react';
import { Badge, CodeBlock, Button, Select, Table, Tabs } from '@cloudflare/kumo';
import type { FlowRun } from '@catbots/strategy-runtime/node-examples';
export type DebugValue = FlowRun['trace'][number]['outputs'][string];
export type DataPort = { name: string; type: string; value?: DebugValue; connections: { nodeId: string; label: string; port: string }[] };
const pageSize = 20;
const text = (value: unknown): string => value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const cellText = (value: unknown, key: string) => key === 'closedAt' && typeof value === 'number' && Number.isFinite(value) ? new Date(value).toLocaleString() : typeof value === 'number' && Number.isFinite(value) && (value === 0 || Math.abs(value) >= 1e-8) ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) : text(value);
const typeOf = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
/** Runtime schema is a description of observed fields, not a replacement for the port contract. */
export function observedFields(value: unknown, path = '$', depth = 0): { path: string; type: string }[] {
  const fields = [{ path, type: typeOf(value) }];
  if (depth >= 4 || value === null || typeof value !== 'object') return fields;
  if (Array.isArray(value)) {
    if (value.length) fields.push(...observedFields(value[0], `${path}[0]`, depth + 1));
  } else for (const [key, child] of Object.entries(value).slice(0, 40)) fields.push(...observedFields(child, `${path}.${key}`, depth + 1));
  return fields;
}
export function NodeDataPanel({ direction, ports, onSelectNode, trigger = false }: { direction: 'input' | 'output'; ports: DataPort[]; onSelectNode?(id: string): void; trigger?: boolean }) {
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState('table');
  const [page, setPage] = useState(0);
  const port = ports.find(item => item.name === selected) ?? ports[0];
  const value = port?.value;
  const executionItems = port?.type === 'items' && value?.quality === 'ready' ? value.value as { json: Record<string, unknown>; pairedItem?: { nodeId: string; port: string; item: number }[] }[] : undefined;
  const rows = executionItems ? executionItems.map(item => item.json) : Array.isArray(value?.value) ? value.value : value?.quality === 'ready' ? [value.value] : [];
  const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const index = Math.min(page, maxPage);
  const visible = rows.slice(index * pageSize, (index + 1) * pageSize);
  const columns = [...new Set(visible.flatMap(row => row !== null && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : ['value']))].slice(0, 12);
  return <section className={`node-data-panel node-data-${direction}`} aria-label={`${direction === 'input' ? 'Input' : 'Output'} panel`}>
    <header><h3>{direction === 'input' ? 'Input' : 'Output'}</h3>{port && <Badge variant="secondary">{port.type}</Badge>}</header>
    {!port ? <div className="node-data-empty"><h4>{direction === 'input' ? 'No input required' : 'No output ports'}</h4><p>{trigger ? 'This trigger starts an evaluation and supplies the initial data.' : direction === 'input' ? 'This node uses its parameters or the shared run context.' : 'This node finishes this part of the flow.'}</p></div> : <>
      <Select size="sm" label={`${direction === 'input' ? 'Input' : 'Output'} port`} value={port.name} onValueChange={name => { setSelected(String(name)); setPage(0); }} renderValue={name => String(name)}>{ports.map(item => <Select.Option key={item.name} value={item.name}>{item.name} · {item.type}</Select.Option>)}</Select>
      <div className="node-data-connections">{port.connections.length ? port.connections.map(connection => <Button key={`${connection.nodeId}:${connection.port}`} size="sm" variant="ghost" disabled={!onSelectNode} onClick={() => onSelectNode?.(connection.nodeId)}>{direction === 'input' ? 'From' : 'To'} {connection.label} · {connection.port}</Button>) : <p>{direction === 'input' ? 'No source connected' : 'No downstream connection'}</p>}</div>
      <Tabs value={mode} onValueChange={setMode} tabs={[{ value: 'schema', label: 'Schema' }, { value: 'table', label: 'Table' }, { value: 'json', label: 'JSON' }]} />
      {!value ? <div className="node-data-empty"><h4>No execution data</h4><p>Execute this step to fetch current market data and evaluate its required upstream nodes.</p></div> : value.quality !== 'ready' ? <div className="node-data-empty"><Badge variant="info">Unavailable</Badge><p>{value.reason ?? 'This branch did not produce a value.'}</p></div> : <>
        <p className="node-data-count"><Badge variant="success">ready</Badge> {rows.length} {Array.isArray(value.value) ? 'records' : 'value'}{port.type === 'candles' ? ' · closed candles' : ''}</p>
        {executionItems && <p>JSON items · {executionItems.length} items · empty output skips the next step</p>}
        {executionItems?.slice(index * pageSize, (index + 1) * pageSize).map((item, itemIndex) => <div key={itemIndex} className="node-data-connections">{item.pairedItem?.map((link, linkIndex) => <Button key={linkIndex} size="sm" variant="ghost" disabled={!onSelectNode} onClick={() => onSelectNode?.(link.nodeId)}>Item {index * pageSize + itemIndex + 1} ← {link.nodeId}.{link.port} [{link.item}]</Button>)}</div>)}
        <div className="node-data-content">{mode === 'json' ? <CodeBlock lang="jsonc" code={JSON.stringify(value.value, null, 2) ?? "null"}/> : mode === 'schema' ? <><p>Observed schema · arrays use their first record</p><Table aria-label={`${direction} schema`}><Table.Header><Table.Row><Table.Head>Field</Table.Head><Table.Head>Type</Table.Head></Table.Row></Table.Header><Table.Body>{observedFields(executionItems ? executionItems.map(item => item.json) : value.value).map(field => <Table.Row key={field.path}><Table.Cell><code>{field.path}</code></Table.Cell><Table.Cell>{field.type}</Table.Cell></Table.Row>)}</Table.Body></Table></> : <Table aria-label={`${direction} data`}><Table.Header><Table.Row>{columns.map(key => <Table.Head key={key}>{key}</Table.Head>)}</Table.Row></Table.Header><Table.Body>{visible.map((row, rowIndex) => <Table.Row key={index * pageSize + rowIndex}>{columns.map(key => <Table.Cell key={key}><span title={text(row !== null && typeof row === 'object' && !Array.isArray(row) ? row[key] : row)}>{cellText(row !== null && typeof row === 'object' && !Array.isArray(row) ? row[key] : row, key)}</span></Table.Cell>)}</Table.Row>)}</Table.Body></Table>}</div>
        {mode === 'table' && rows.length > pageSize && <div className="node-data-pagination"><Button size="sm" variant="secondary" disabled={!index} onClick={() => setPage(index - 1)}>Previous records</Button><span>{index * pageSize + 1}–{Math.min((index + 1) * pageSize, rows.length)} of {rows.length}</span><Button size="sm" variant="secondary" disabled={index === maxPage} onClick={() => setPage(index + 1)}>Next records</Button></div>}
      </>}
    </>}
  </section>;
}
