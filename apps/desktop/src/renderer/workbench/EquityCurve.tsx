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
      <svg className="equity-curve" viewBox="0 0 600 180" role="img" aria-label="Equity curve"><title>Observed equity over this sample backtest period</title><polyline points={path} /></svg>
      <Collapsible.Root className="equity-table"><Collapsible.Trigger render={<Button variant="ghost" size="sm" />}>View accessible equity data</Collapsible.Trigger><Collapsible.Panel>
        <Table aria-label="Equity curve data"><Table.Header><Table.Row><Table.Head>Time</Table.Head><Table.Head>Equity</Table.Head></Table.Row></Table.Header><Table.Body>
          {points.map((point) => <Table.Row key={point.timestamp}><Table.Cell><time dateTime={point.timestamp}>{new Date(point.timestamp).toLocaleString()}</time></Table.Cell><Table.Cell>{point.equity}</Table.Cell></Table.Row>)}
        </Table.Body></Table>
      </Collapsible.Panel></Collapsible.Root>
    </LayerCard>
  );
}
