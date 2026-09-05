import { useState } from 'react';
import { Badge, Banner, Button, Input, LayerCard, Select, Table } from '@cloudflare/kumo';
import { ChartLineUpIcon, PlayIcon } from '@phosphor-icons/react';
import type { BacktestSummary, CatbotsDesktopApi, StrategyRevision } from '@catbots/contracts';

import { TraceTimeline } from './TraceTimeline';
import { EquityCurve } from './EquityCurve';

export function BacktestPanel({ botId, revision, backtests, api, onCompleted }: {
  botId: string;
  revision: StrategyRevision;
  backtests: readonly BacktestSummary[];
  api: Pick<CatbotsDesktopApi['workbench'], 'runBacktest' | 'getTrace'>;
  onCompleted(backtest: BacktestSummary): void;
}) {
  const [selected, setSelected] = useState<BacktestSummary | null>(backtests[0] ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const [assumptions, setAssumptions] = useState(defaultAssumptions);
  const run = async () => {
    setRunning(true);
    setError(false);
    try {
      const result = await api.runBacktest({ botId, revisionVersion: revision.version, marketUniverse: { mode: 'all_available' }, assumptions });
      setSelected(result);
      onCompleted(result);
    } catch {
      setError(true);
    } finally {
      setRunning(false);
    }
  };
  return (
    <section className="backtest-panel" aria-labelledby="backtest-title">
      <header className="backtest-toolbar">
        <div><p className="eyebrow">DETERMINISTIC REPLAY</p><h2 id="backtest-title">Backtest v{revision.version}</h2></div>
        {backtests.length > 0 ? (
          <Select<string> size="base" items={backtests.map((run) => ({ value: run.id, label: new Date(run.startedAt).toLocaleString() }))} label="Backtest run" value={selected?.id ?? backtests[0]!.id} onValueChange={(id) => setSelected(backtests.find((item) => item.id === id) ?? null)}>
            {backtests.map((runItem) => <Select.Option key={runItem.id} value={runItem.id}>{new Date(runItem.startedAt).toLocaleString()}</Select.Option>)}
          </Select>
        ) : null}
        <Button size="base" type="button" variant="primary" icon={PlayIcon} loading={running} disabled={running} onClick={() => void run()}>Run backtest</Button>
      </header>
      <div className="backtest-assumption-form" aria-label="Backtest assumptions">
        <Input size="base" label="From" type="date" value={assumptions.from.slice(0, 10)} onChange={(event) => setAssumptions((value) => ({ ...value, from: `${event.currentTarget.value}T00:00:00.000Z` }))} />
        <Input size="base" label="To" type="date" value={assumptions.to.slice(0, 10)} onChange={(event) => setAssumptions((value) => ({ ...value, to: `${event.currentTarget.value}T00:00:00.000Z` }))} />
        <Input size="base" label="Starting capital" inputMode="decimal" value={assumptions.startingCapital} onChange={(event) => setAssumptions((value) => ({ ...value, startingCapital: event.currentTarget.value }))} />
        <Input size="base" label="Fee (bps)" type="number" min="0" step="0.1" value={assumptions.feeRateBps} onChange={(event) => setAssumptions((value) => ({ ...value, feeRateBps: Number(event.currentTarget.value) }))} />
        <Input size="base" label="Slippage (bps)" type="number" min="0" step="0.1" value={assumptions.slippageBps} onChange={(event) => setAssumptions((value) => ({ ...value, slippageBps: Number(event.currentTarget.value) }))} />
      </div>
      {error ? <Banner variant="error" title="Backtest failed" description="The local backtest could not be completed. Review the revision and try again." /> : null}
      {selected === null ? (
        <LayerCard className="backtest-empty"><ChartLineUpIcon aria-hidden="true" size={32} /><h3>No results yet</h3><p>Run this revision against the bundled sample dataset before approval.</p></LayerCard>
      ) : (
        <div className="backtest-results">
          <div className="backtest-provenance"><Badge variant="info">{selected.dataSource}</Badge><span>Revision v{selected.revisionVersion}</span><span>{formatRange(selected.assumptions.from, selected.assumptions.to)}</span></div>
          <p className="backtest-observation">These are observed simulation results under the pinned assumptions below, not a forecast or investment promise.</p>
          <section className="backtest-result-section" aria-labelledby="portfolio-performance-heading">
            <h3 id="portfolio-performance-heading">Portfolio performance</h3>
            <div className="metric-grid">
              <Metric label="Return" value={formatPercent(selected.metrics.returnPercent, true)} />
              <Metric label="Max drawdown" value={formatPercent(selected.metrics.maximumDrawdownPercent)} />
              <Metric label="Sharpe-like" value={selected.metrics.sharpeLike.toFixed(2)} />
              <Metric label="Win rate" value={formatPercent(selected.metrics.winRatePercent)} />
              <Metric label="Trades" value={String(selected.metrics.tradeCount)} />
              <Metric label="Fees / funding" value={`${selected.metrics.fees} / ${selected.metrics.funding}`} />
            </div>
          </section>
          <LayerCard className="backtest-coverage">
            <div>
              <h3>Dataset coverage</h3>
              <p>{selected.datasetCoverage === null ? 'Not recorded in this legacy Backtest.' : formatRange(selected.datasetCoverage.from, selected.datasetCoverage.to)}</p>
            </div>
            <div>
              <span>Markets in this dataset</span>
              <strong>{selected.datasetCoverage?.markets.join(', ') ?? 'Not recorded'}</strong>
            </div>
          </LayerCard>
          <LayerCard className="backtest-by-market">
            <h3>By market</h3>
            {selected.perMarket.length === 0 ? <p className="backtest-muted">{selected.legacyProjection ? 'Per-market attribution was not recorded.' : 'No eligible market produced a result in this replay.'}</p> : (
              <Table aria-label="Backtest results by market">
                <Table.Header><Table.Row><Table.Head>Market</Table.Head><Table.Head>Realized PnL</Table.Head><Table.Head>Trades</Table.Head><Table.Head>Win rate</Table.Head><Table.Head>Drawdown contribution</Table.Head></Table.Row></Table.Header>
                <Table.Body>{selected.perMarket.map((market) => (
                  <Table.Row key={market.market}>
                    <Table.Cell><strong>{market.market}</strong></Table.Cell>
                    <Table.Cell>{formatUsd(market.realizedPnl)}</Table.Cell>
                    <Table.Cell>{market.tradeCount}</Table.Cell>
                    <Table.Cell>{formatPercent(market.winRatePercent)}</Table.Cell>
                    <Table.Cell>{formatPercent(market.drawdownContributionPercent)}</Table.Cell>
                  </Table.Row>
                ))}</Table.Body>
              </Table>
            )}
          </LayerCard>
          <EquityCurve points={selected.equityCurve} />
          {selected.trades.length === 0 ? null : <LayerCard className="backtest-trades"><h3>Trades</h3><Table aria-label="Backtest trades"><Table.Header><Table.Row><Table.Head>Trace</Table.Head><Table.Head>Market</Table.Head><Table.Head>Side</Table.Head><Table.Head>Realized PnL</Table.Head></Table.Row></Table.Header><Table.Body>
            {selected.trades.map((trade) => <Table.Row key={trade.traceId}><Table.Cell><code>{trade.traceId}</code></Table.Cell><Table.Cell>{trade.market}</Table.Cell><Table.Cell>{trade.side}</Table.Cell><Table.Cell>{trade.realizedPnl}</Table.Cell></Table.Row>)}
          </Table.Body></Table></LayerCard>}
          {selected.warnings.map((warning) => <div key={warning} role="alert"><Banner variant="alert" title="Backtest assumption" description={warning} /></div>)}
          <TraceTimeline backtestId={selected.id} botId={botId} revisionVersion={selected.revisionVersion} traces={selected.traces} api={api} />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <LayerCard className="metric-card"><span>{label}</span><strong>{value}</strong></LayerCard>;
}

function defaultAssumptions() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString(), startingCapital: '10000', feeRateBps: 3.5, slippageBps: 1 };
}

function formatPercent(value: number, signed = false): string {
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatRange(from: string, to: string): string {
  return `${new Date(from).toLocaleDateString()} – ${new Date(to).toLocaleDateString()}`;
}

function formatUsd(value: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
}
