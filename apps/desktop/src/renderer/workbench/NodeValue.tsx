import { useState } from 'react';
import { Button, Table, CodeBlock } from '@cloudflare/kumo';

/** Keep large candle payloads out of the reading path; raw data remains inspectable. */
export function NodeValue({ value }: { value: unknown }) {
  const [raw, setRaw] = useState(false);
  const rows = Array.isArray(value) ? value : null;
  const object = value !== null && typeof value === 'object';
  const columns = rows?.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).slice(0, 8) : [];
  const scalar = (item: unknown) => item !== null && typeof item === 'object' ? JSON.stringify(item) : String(item ?? '—');
  return <div className="node-value">
    {object && <Button size="sm" variant="ghost" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? 'Show summary' : 'Show JSON'}</Button>}
    {raw ? <CodeBlock lang="jsonc" code={JSON.stringify(value, null, 2)}/> : rows ? <><p>{rows.length} records · latest 5 shown</p>{columns.length ? <Table aria-label="Latest records"><Table.Header><Table.Row>{columns.map(key => <Table.Head key={key}>{key}</Table.Head>)}</Table.Row></Table.Header><Table.Body>{rows.slice(-5).map((row, index) => <Table.Row key={index}>{columns.map(key => <Table.Cell key={key}>{key === 'closedAt' && typeof row[key] === 'number' ? <span title={new Date(row[key]).toISOString()}>{new Date(row[key]).toLocaleString()}</span> : scalar(row[key])}</Table.Cell>)}</Table.Row>)}</Table.Body></Table> : <CodeBlock lang="jsonc" code={JSON.stringify(rows.slice(-5),null,2)}/>}</> : object ? <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{scalar(item)}</dd></div>)}</dl> : <p className="node-value-scalar">{scalar(value)}</p>}
  </div>;
}
