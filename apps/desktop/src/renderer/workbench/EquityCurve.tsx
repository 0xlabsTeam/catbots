import { Collapsible, Button, LayerCard, Table } from '@cloudflare/kumo';
import type { BacktestSummary } from '@catbots/contracts';

export function EquityCurve({ points }: { points: BacktestSummary['equityCurve'] }) {
  const values = points.map(({ equity }) => Number(equity));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(1, maximum - minimum);
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : index / (points.length - 1) * 600;
    const y = 170 - (Number(point.equity) - minimum) / spread * 150;
    return `${x},${y}`;
  }).join(' ');
  return (
    <LayerCard className="equity-card">
      <h3>Equity curve</h3>
      {points.length>0&&<div className="equity-chart-labels backtest-muted"><span>Low {minimum.toLocaleString(undefined,{maximumFractionDigits:2})}</span><span>High {maximum.toLocaleString(undefined,{maximumFractionDigits:2})}</span></div>}
      <svg className="equity-curve" viewBox="0 0 600 180" role="img" aria-label="Equity curve"><title>Observed equity over the backtest period</title><polyline points={path} /></svg>
      {points.length>0&&<div className="equity-chart-labels backtest-muted"><time dateTime={points[0].timestamp}>{new Date(points[0].timestamp).toISOString().slice(0,10)}</time><span>UTC</span><time dateTime={points[points.length-1].timestamp}>{new Date(points[points.length-1].timestamp).toISOString().slice(0,10)}</time></div>}
      <Collapsible.Root className="equity-table"><Collapsible.Trigger render={<Button variant="ghost" size="sm" />}>View accessible equity data</Collapsible.Trigger><Collapsible.Panel>
        <Table aria-label="Equity curve data"><Table.Header><Table.Row><Table.Head>Time</Table.Head><Table.Head>Equity</Table.Head></Table.Row></Table.Header><Table.Body>
          {points.map((point) => <Table.Row key={point.timestamp}><Table.Cell><time dateTime={point.timestamp}>{new Date(point.timestamp).toLocaleString()}</time></Table.Cell><Table.Cell>{point.equity}</Table.Cell></Table.Row>)}
        </Table.Body></Table>
      </Collapsible.Panel></Collapsible.Root>
    </LayerCard>
  );
}
