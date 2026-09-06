import { Badge, Banner, Button, Dialog, Table } from '@cloudflare/kumo';
import type { BotExecutionOverview } from '@catbots/contracts';

export function executionStatus(view?: BotExecutionOverview) {
  return view?.deployment?.status;
}
export function ExecutionBadge({view}:{view:BotExecutionOverview}) {
  const status=executionStatus(view);
  const label=status==='failed'?'Error':status==='interrupted'?'Interrupted':status ? status.charAt(0).toUpperCase()+status.slice(1) : 'Not started';
  return <Badge variant={status==='running'?'success':status==='failed'?'error':'neutral'} appearance="dot">{label} · {view.environment==='testnet'?'Testnet':'Mainnet'}</Badge>;
}
export function BotExecutionActivity({name,view,onClose}:{name:string;view:BotExecutionOverview;onClose():void}) {
  const activity=view.activity;
  const positions=activity?.positions.filter(item=>item.market===view.target?.market)??[];
  const orders=activity?.orders.filter(item=>item.market===view.target?.market)??[];
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog className="node-editor-dialog" aria-label="Trading activity">
    <Dialog.Title>{name} · Trading activity</Dialog.Title>
    <p>{view.accountName??'Account'} · {view.target?.market} · {view.environment==='testnet'?'Testnet':'Mainnet'}</p>
    <p>Positions and open orders are shared by this account and market. They may include manual trades or other bots.</p>
    {view.deployment?.error && <Banner variant="error" title="Runtime stopped" description={view.deployment.error}/>}
    {view.activityError && <Banner variant="error" title="Exchange unavailable" description={view.activityError}/>}
    {activity && <><p>Exchange snapshot · {new Date(activity.fetchedAt).toLocaleTimeString()}</p>
      <h3>Positions</h3>{positions.length ? <Table><Table.Header><Table.Row>{['Side','Size','Entry price','Unrealized PnL'].map(label=><Table.Head key={label}>{label}</Table.Head>)}</Table.Row></Table.Header><Table.Body>{positions.map((item,index)=><Table.Row key={index}><Table.Cell>{Number(item.size)>0?'Long':'Short'}</Table.Cell><Table.Cell>{Math.abs(Number(item.size))}</Table.Cell><Table.Cell>{item.entryPrice??'—'}</Table.Cell><Table.Cell>{item.unrealizedPnl} USDC</Table.Cell></Table.Row>)}</Table.Body></Table>:<p>No open position</p>}
      <h3>Open orders</h3>{orders.length ? <Table><Table.Header><Table.Row>{['Order ID','Side','Size','Limit price'].map(label=><Table.Head key={label}>{label}</Table.Head>)}</Table.Row></Table.Header><Table.Body>{orders.map(item=><Table.Row key={item.id}><Table.Cell>{item.id}</Table.Cell><Table.Cell>{item.side}</Table.Cell><Table.Cell>{item.size}</Table.Cell><Table.Cell>{item.price}</Table.Cell></Table.Row>)}</Table.Body></Table>:<p>No open orders</p>}</>}
    <h3>Recent bot orders</h3>{view.deployment?.orders.length ? <Table><Table.Header><Table.Row>{['Time','Side','Size','Status','Exchange ID'].map(label=><Table.Head key={label}>{label}</Table.Head>)}</Table.Row></Table.Header><Table.Body>{view.deployment.orders.slice(-20).reverse().map(item=><Table.Row key={item.id}><Table.Cell>{new Date(item.at).toLocaleTimeString()}</Table.Cell><Table.Cell>{item.side??'—'}</Table.Cell><Table.Cell>{item.quantity??'—'}</Table.Cell><Table.Cell>{item.status}</Table.Cell><Table.Cell>{item.exchangeOrderId??'—'}</Table.Cell></Table.Row>)}</Table.Body></Table>:<p>No bot orders recorded</p>}
    <Button size="base" variant="secondary" onClick={onClose}>Close</Button>
  </Dialog></Dialog.Root>;
}
