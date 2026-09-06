import { useSyncExternalStore } from 'react';
import { Collapsible, Button, LayerCard, Table } from '@cloudflare/kumo';
import { TimeseriesChart, ChartPalette } from '@cloudflare/kumo/components/chart';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, BrushComponent, ToolboxComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { BacktestSummary } from '@catbots/contracts';

echarts.use([LineChart, GridComponent, TooltipComponent, BrushComponent, ToolboxComponent, CanvasRenderer]);

const darkModeQuery = '(prefers-color-scheme: dark)';
const subscribeToTheme = (notify: () => void) => {
  const query = window.matchMedia(darkModeQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const getDarkMode = () => window.matchMedia(darkModeQuery).matches;

export function EquityCurve({ points }: { points: BacktestSummary['equityCurve'] }) {
  const isDarkMode = useSyncExternalStore(subscribeToTheme, getDarkMode, () => false);
  const values = points.map(({ equity }) => Number(equity));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return (
    <LayerCard className="equity-card">
      <h3>Equity curve</h3>
      {points.length>0&&<div className="equity-chart-labels backtest-muted"><span>Low {minimum.toLocaleString(undefined,{maximumFractionDigits:2})}</span><span>High {maximum.toLocaleString(undefined,{maximumFractionDigits:2})}</span></div>}
      <TimeseriesChart echarts={echarts} isDarkMode={isDarkMode} height={240} ariaDescription="Observed equity over the backtest period. Exact values are available in the equity data table below." data={[{ name: 'Equity', color: ChartPalette.categorical(0, isDarkMode), data: points.map(point => [new Date(point.timestamp).getTime(), Number(point.equity)]) }]} xAxisName="Time (UTC)" yAxisName="USD" tooltipValueFormat={value => value.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
      {points.length>0&&<div className="equity-chart-labels backtest-muted"><time dateTime={points[0].timestamp}>{new Date(points[0].timestamp).toISOString().slice(0,10)}</time><span>UTC</span><time dateTime={points[points.length-1].timestamp}>{new Date(points[points.length-1].timestamp).toISOString().slice(0,10)}</time></div>}
      <Collapsible.Root className="equity-table"><Collapsible.Trigger render={<Button variant="ghost" size="sm" />}>View accessible equity data</Collapsible.Trigger><Collapsible.Panel>
        <Table aria-label="Equity curve data"><Table.Header><Table.Row><Table.Head>Time</Table.Head><Table.Head>Equity</Table.Head></Table.Row></Table.Header><Table.Body>
          {points.map((point) => <Table.Row key={point.timestamp}><Table.Cell><time dateTime={point.timestamp}>{new Date(point.timestamp).toLocaleString()}</time></Table.Cell><Table.Cell>{point.equity}</Table.Cell></Table.Row>)}
        </Table.Body></Table>
      </Collapsible.Panel></Collapsible.Root>
    </LayerCard>
  );
}
