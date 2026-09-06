import { useState } from 'react';
import { Badge, Button, CodeBlock, Collapsible, Input, LayerCard, Select, Tabs } from '@cloudflare/kumo';
import type { FlowDeployment } from '@catbots/contracts';

type NodeEntry = { nodeId: string; status?: string; inputs?: unknown; outputs?: unknown };
function nodeEntries(trace: unknown): NodeEntry[] {
  return Array.isArray(trace) ? trace.filter((entry): entry is NodeEntry => !!entry && typeof entry === 'object' && typeof entry.nodeId === 'string') : [];
}
const readableTime = (value:string) => new Date(value).toLocaleString();
export function ExecutionLogPanel({run}:{run:FlowDeployment}) {
  const [tab,setTab]=useState('nodes');
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const nodes=nodeEntries(run.trace);
  const issues=(status:string)=>['failed','error','uncertain','unavailable','rejected'].includes(status);
  const matches=(label:string,status:string)=>label.toLowerCase().includes(query.trim().toLowerCase())&&(filter==='all'||issues(status));
  const shownNodes=nodes.filter(node=>matches(node.nodeId,node.status??'unknown'));
  const shownOrders=[...run.orders].reverse().filter(order=>matches([order.id,order.exchangeOrderId,order.nodeId,order.side,order.status].join(' '),order.status));
  const count=tab==='nodes'?shownNodes.length:shownOrders.length;
  return <LayerCard className="deploy-card execution-log-panel">
    <Tabs tabs={[{value:'nodes',label:`Node activity (${nodes.length})`},{value:'orders',label:`Order events (${run.orders.length})`}]} value={tab} onValueChange={setTab}/>
    <div className="execution-log-toolbar">
      <Input size="base" aria-label="Search execution logs" placeholder={tab==='nodes'?'Search node ID…':'Search order, node or side…'} value={query} onChange={event=>setQuery(event.target.value)}/>
      <Select size="base" aria-label="Filter execution logs" value={filter} onValueChange={value=>setFilter(value??'all')} items={{all:'All statuses',issues:'Needs attention'}}><Select.Option value="all">All statuses</Select.Option><Select.Option value="issues">Needs attention</Select.Option></Select>
      <span className="backtest-muted" role="status">{count} results</span>
    </div>
    <p className="backtest-muted">{tab==='nodes' ? `Latest evaluation only${run.lastRunAt ? ` · ${readableTime(run.lastRunAt)}` : ''}. Open a node to inspect its data.` : 'Recorded order outcomes · Newest first. This is not a live open-order list.'}</p>
    {count===0 && <div className="execution-log-empty"><h3>{query||filter!=='all'?'No matching events':'No events yet'}</h3><p className="backtest-muted">{query||filter!=='all'?'Try another search or show all statuses.':tab==='nodes'?'Node data will appear after an evaluation.':'Orders will appear when the strategy sends a signal.'}</p>{(query||filter!=='all')&&<Button variant="secondary" size="sm" onClick={()=>{setQuery('');setFilter('all');}}>Clear filters</Button>}</div>}
    <div className="execution-log-entries">
      {tab==='nodes' ? shownNodes.map((node,index)=><Collapsible.Root key={`${node.nodeId}:${index}`}>
        <Collapsible.Trigger render={<Button size="base" variant="ghost" className="execution-log-entry"/>}><span>{node.nodeId}</span><Badge variant={node.status==='executed'?'success':issues(node.status??'')?'warning':'neutral'}>{node.status??'Unknown'}</Badge><span className="backtest-muted">View data</span></Collapsible.Trigger>
        <Collapsible.Panel><div className="execution-log-data"><div><h3>Input</h3><CodeBlock lang="jsonc" code={JSON.stringify(node.inputs??{},null,2)}/></div><div><h3>Output</h3><CodeBlock lang="jsonc" code={JSON.stringify(node.outputs??{},null,2)}/></div></div></Collapsible.Panel>
      </Collapsible.Root>) : shownOrders.map(order=><Collapsible.Root key={order.id}>
        <Collapsible.Trigger render={<Button size="base" variant="ghost" className="execution-log-entry"/>}><time dateTime={order.at}>{readableTime(order.at)}</time><span>{order.side?.toUpperCase()??'Order'} {order.quantity??'—'}{order.price!==undefined?` @ ${order.price}`:''}</span><Badge variant={order.status==='filled'?'success':issues(order.status)?'warning':'neutral'}>{order.status}</Badge><span className="backtest-muted">Details</span></Collapsible.Trigger>
        <Collapsible.Panel><div className="execution-log-order"><p>Node: {order.nodeId??'Not recorded'} · Exchange ID: {order.exchangeOrderId??'Not confirmed'}</p><CodeBlock lang="jsonc" code={JSON.stringify(order,null,2)}/></div></Collapsible.Panel>
      </Collapsible.Root>)}
    </div>
    {tab==='nodes' && nodes.length===0 && run.events.length>0 && <Collapsible.Root><Collapsible.Trigger render={<Button variant="secondary" size="sm"/>}>Recorded runtime messages</Collapsible.Trigger><Collapsible.Panel>{run.events.map((event,index)=><p key={index}>{event}</p>)}</Collapsible.Panel></Collapsible.Root>}
  </LayerCard>;
}
