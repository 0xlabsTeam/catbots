import type {
  BacktestDatasetCoverage,
  SimulationLedgerEntry,
  SimulationSnapshot,
} from './backtest-types';
import { defaultBacktestRiskLimits, RiskLimitsSchema } from '@catbots/contracts';
import { evaluateRisk } from '@catbots/execution-core/risk-engine';
import type { NormalizedOrderIntent } from '@catbots/execution-core';
import type { BacktestRequest } from './backtest';
import { createBuiltinRegistry } from './builtins';
import { createEvaluationContext, type EvaluationValue } from './evaluation-context';
import { coordinateEvaluation, type CoordinatedEvaluation } from './evaluation-coordinator';
import { validateStrategy } from './graph-validator';
import { orderedActiveMarkets, type MarketUniverseSnapshot } from './market-universe';
import {
  calculateBacktestMetrics,
  calculatePerMarketBacktestMetrics,
  type BacktestMetrics,
  type EquityPoint,
  type MarketContributionPoint,
  type PerMarketBacktestMetrics,
} from './metrics';
import { SimulatedExecutionAdapter } from './simulated-adapter';
import { SimulationClock } from './simulation-clock';
import { serializeCanonicalJson, type JsonValue } from './strategy-schema';

export type BacktestReplayResult = Readonly<{
  status: 'completed' | 'cancelled';
  metrics: BacktestMetrics;
  perMarket: readonly PerMarketBacktestMetrics[];
  datasetCoverage: BacktestDatasetCoverage;
  snapshot: SimulationSnapshot;
  equityCurve: readonly EquityPoint[];
  trades: readonly SimulationLedgerEntry[];
  traces: readonly CoordinatedEvaluation[];
  warnings: readonly string[];
}>;

export function replayBacktest(
  request: BacktestRequest,
  identityHash: (value: string) => string,
): BacktestReplayResult {
  const total = request.inputs.length;
  request.onProgress?.({ phase: 'validating', completed: 0, total });
  const validation = validateStrategy(request.strategy, createBuiltinRegistry());
  if (!validation.valid) {
    throw new Error(`Backtest strategy is invalid: ${validation.errors.map((error) => error.code).join(', ')}`);
  }
  validateFrameUniverseTimes(request.inputs);
  const coverage = normalizeCoverage(request.datasetCoverage);
  const selected = selectedMarkets(request.marketUniverse, coverage);

  const clock = new SimulationClock(request.range.from);
  const orderedInputs = clock.order(request.inputs);
  const adapter = new SimulatedExecutionAdapter({ assumptions: request.assumptions });
  const riskLimits = RiskLimitsSchema.parse(request.assumptions.riskLimits ?? defaultBacktestRiskLimits(request.assumptions.startingCapital));
  const orderTimes: string[] = [];
  let peakEquity = Number(request.assumptions.startingCapital);
  const equityCurve: EquityPoint[] = [{ timestamp: clock.now(), equity: request.assumptions.startingCapital }];
  const marketContributionCurve: MarketContributionPoint[] = [{
    timestamp: clock.now(),
    contributions: Object.freeze(Object.fromEntries([...selected].sort().map((market) => [market, '0']))),
  }];
  const recordPeak = () => {
    const equity = adapter.snapshot().equity;
    if (Number(equity) <= peakEquity) return;
    peakEquity = Number(equity);
    equityCurve.push({ timestamp: clock.now(), equity });
    marketContributionCurve.push({ timestamp: clock.now(), contributions: adapter.marketEquityContributions() });
  };
  const traces: CoordinatedEvaluation[] = [];
  const replayWarnings = new Set<string>();
  let status: 'completed' | 'cancelled' = 'completed';
  request.onProgress?.({ phase: 'replaying', completed: 0, total });

  for (const [index, input] of orderedInputs.entries()) {
    if (request.shouldCancel?.()) {
      status = 'cancelled';
      break;
    }
    clock.advanceTo(input.occurredAt);
    const universe = filteredUniverse(input.universe, selected);
    const marketsWithValues = Object.keys(input.marketValues)
      .filter((market) => selected.has(market))
      .sort();
    const heldMarkets = new Set(adapter.snapshot().positions.map(({ market }) => market));
    const marketContexts = new Map<string, ReturnType<typeof createEvaluationContext>>();
    for (const market of marketsWithValues) {
      const values = input.marketValues[market];
      if (!values) continue;
      const context = createEvaluationContext({ evaluatedAt: clock.now(), currentMarket: market, values });
      marketContexts.set(market, context);
    }
    const markResult = adapter.markPortfolio([...marketContexts.values()]);
    recordPeak();
    const markedMarkets = new Set(markResult.markedMarkets);
    const unavailableMarks = new Map(
      markResult.unavailableMarks.map(({ market, reason }) => [market, reason]),
    );
    for (const market of [...heldMarkets].sort()) {
      if (markedMarkets.has(market)) continue;
      replayWarnings.add(`stale_mark:${market}:${unavailableMarks.get(market) ?? 'missing'}`);
    }
    for (const [market, context] of marketContexts) {
      if (!markedMarkets.has(market)) continue;
      const fundingRate = input.fundingRates?.[market];
      if (fundingRate !== undefined) adapter.applyFunding(fundingRate, context);
      recordPeak();
    }

    const coordinated = coordinateEvaluation({
      compiled: validation.compiled,
      triggerNodeId: input.triggerNodeId,
      triggerInput: input.triggerInput,
      universe,
      isHeldMarket: (market) => adapter.riskPositions().some((position) => position.market === market),
      contextFactory: (market) => {
        const before = adapter.snapshot();
        const values = input.marketValues[market] ?? {};
        return createEvaluationContext({
          evaluatedAt: clock.now(),
          currentMarket: market,
          ...(input.triggerInput.kind === 'event' ? { triggerEvent: input.triggerInput.event } : {}),
          values: {
            ...values,
            'account.positions': simulationValue(
              before.positions as unknown as JsonValue,
              clock.now(),
              identityHash(`positions:${index}:${market}:${canonical(before.positions)}`),
            ),
            'account.equity': simulationValue(
              Number(before.equity),
              clock.now(),
              identityHash(`equity:${index}:${market}:${before.equity}`),
            ),
          },
        });
      },
      deployment: {
        id: `backtest:${request.strategy.strategy.id}:v${request.strategy.strategy.version}`,
        mode: 'backtest',
      },
      execution: {
        execute: (effect, context) => {
          const market = universe.markets.find(({ symbol }) => symbol === effect.market);
          const snapshot = adapter.snapshot();
          const equity = Number(snapshot.equity);
          recordPeak();
          const size = effect.config.size;
          const intent: NormalizedOrderIntent | undefined = effect.type === 'execution.close_position'
            ? { type: 'close_position', market: effect.market, percent: Number(effect.config.percent ?? 100), clientOrderId: effect.idempotencyKey }
            : effect.type === 'execution.open_position' && (effect.config.side === 'long' || effect.config.side === 'short')
              && size !== null && typeof size === 'object' && !Array.isArray(size)
              ? { type: 'open_position', market: effect.market, side: effect.config.side, orderType: 'market',
                notionalUsd: String(Number(size.value) * (size.type === 'equity_percent' ? equity / 100 : size.type === 'quote' ? 1 : Number.NaN)),
                leverage: Number(effect.config.leverage ?? 1), clientOrderId: effect.idempotencyKey } : undefined;
          const dailyPnl = snapshot.ledger.filter((entry) => entry.timestamp.slice(0, 10) === context.evaluatedAt.slice(0, 10))
            .reduce((sum, entry) => sum + Number(entry.realizedPnl ?? 0) - Number(entry.fee ?? 0) - Number(entry.amount ?? 0), 0);
          const decision = intent === undefined ? { approved: false, violatedRuleIds: ['risk-state-unavailable'] }
            : evaluateRisk({ intent, limits: riskLimits, account: {
              equityUsd: snapshot.equity, dailyRealizedPnlUsd: String(dailyPnl),
              drawdownPercent: (peakEquity - equity) / peakEquity * 100,
              positions: adapter.riskPositions(), recentOrderTimestamps: orderTimes,
              accountKillSwitchActive: false, botKillSwitchActive: false,
            }, botDex: universe.dex, deploymentDex: universe.dex, evaluationDex: universe.dex,
            currentMarket: context.currentMarket, effectMarket: effect.market,
            evaluationUniverseRevision: universe.revision, marketMetadataRevision: universe.revision, marketMetadataDex: universe.dex,
            marketMetadata: market === undefined ? undefined : { market: market.symbol, active: market.active,
              sizeDecimals: market.sizeDecimals, maximumLeverage: market.maximumLeverage },
            universeFresh: true, evaluatedAt: context.evaluatedAt });
          if (!decision.approved) return { events: [{ type: 'risk.rejected', metadata: { violatedRuleIds: decision.violatedRuleIds } }] };
          orderTimes.push(context.evaluatedAt);
          const outcome = adapter.execute(effect, context);
          recordPeak();
          return outcome;
        },
      },
    });
    traces.push(coordinated);
    const endingEquity = adapter.snapshot().equity;
    if (equityCurve.at(-1)?.timestamp !== clock.now() || equityCurve.at(-1)?.equity !== endingEquity) {
      equityCurve.push({ timestamp: clock.now(), equity: endingEquity });
      marketContributionCurve.push({ timestamp: clock.now(), contributions: adapter.marketEquityContributions() });
    }
  }

  request.onProgress?.({ phase: 'calculating', completed: traces.length, total });
  const snapshot = adapter.snapshot();
  const trades = snapshot.ledger.filter((entry) => (
    entry.type === 'liquidation' || (entry.type === 'fill' && entry.effectType === 'execution.close_position')
  ));
  const metrics = calculateBacktestMetrics({
    startingCapital: request.assumptions.startingCapital,
    equityCurve,
    closedTrades: trades.map((trade) => ({ realizedPnl: String(trade.realizedPnl ?? '0') })),
    totalFees: snapshot.totalFees,
    totalFunding: snapshot.totalFunding,
  });
  const warnings = Object.freeze([
    ...new Set([...warningsFor(request, coverage, selected), ...replayWarnings]),
  ].sort());
  const perMarket = calculatePerMarketBacktestMetrics({
    startingCapital: request.assumptions.startingCapital,
    markets: [...selected],
    equityCurve,
    marketContributionCurve,
    closedTrades: trades.map((trade) => ({
      market: trade.market,
      realizedPnl: String(trade.realizedPnl ?? '0'),
    })),
  });

  return Object.freeze({
    status,
    metrics,
    perMarket,
    datasetCoverage: coverage,
    snapshot,
    equityCurve: Object.freeze(equityCurve),
    trades: Object.freeze(trades),
    traces: Object.freeze(traces),
    warnings,
  });
}

function canonical(value: unknown): string {
  return serializeCanonicalJson(value as JsonValue);
}

function simulationValue(value: JsonValue, observedAt: string, integrityHash: string): EvaluationValue {
  return {
    value,
    provider: 'backtest.simulation',
    observedAt,
    freshnessSeconds: 0,
    quality: { status: 'verified' },
    integrityHash,
  };
}

function normalizedMarkets(markets: readonly string[], label: string): readonly string[] {
  const normalized = markets.map((market) => market.trim());
  if (normalized.some((market) => market.length === 0)) throw new Error(`${label} markets must be non-empty`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} markets must be unique`);
  return Object.freeze([...normalized].sort());
}

function normalizeCoverage(coverage: BacktestDatasetCoverage): BacktestDatasetCoverage {
  if (!(Date.parse(coverage.from) < Date.parse(coverage.to))) {
    throw new Error('Dataset coverage start must be before end');
  }
  const markets = normalizedMarkets(coverage.markets, 'Dataset coverage');
  if (markets.length === 0) throw new Error('Dataset coverage must contain at least one market');
  return Object.freeze({ markets, from: coverage.from, to: coverage.to });
}

function selectedMarkets(
  selection: BacktestRequest['marketUniverse'],
  coverage: BacktestDatasetCoverage,
): ReadonlySet<string> {
  const coverageSet = new Set(coverage.markets);
  if (selection.mode === 'all_available') return coverageSet;
  const included = normalizedMarkets(selection.markets, 'Included');
  if (included.length === 0) throw new Error('Included markets must contain at least one market');
  const missing = included.filter((market) => !coverageSet.has(market));
  if (missing.length > 0) {
    throw new Error(`Included market is absent from dataset coverage: ${missing.join(', ')}`);
  }
  return new Set(included);
}

function filteredUniverse(
  universe: MarketUniverseSnapshot,
  selected: ReadonlySet<string>,
): MarketUniverseSnapshot {
  return Object.freeze({
    ...universe,
    markets: Object.freeze(universe.markets.map((market) => Object.freeze({
      ...market,
      active: market.active && selected.has(market.symbol.trim()),
    }))),
  });
}

function warningsFor(
  request: BacktestRequest,
  coverage: BacktestDatasetCoverage,
  selected: ReadonlySet<string>,
): readonly string[] {
  const warnings = new Set<string>();
  if (request.inputs.length < 2) warnings.add('insufficient_history');
  if (Date.parse(request.range.from) < Date.parse(coverage.from)
    || Date.parse(request.range.to) > Date.parse(coverage.to)) {
    warnings.add('missing_market_coverage');
  }
  const coverageSet = new Set(coverage.markets);
  const representedMarkets = new Set<string>();
  for (const input of request.inputs) {
    for (const metadata of input.universe.markets) {
      const market = metadata.symbol.trim();
      representedMarkets.add(market);
      if (metadata.active && request.marketUniverse.mode === 'all_available' && !coverageSet.has(market)) {
        warnings.add('missing_market_coverage');
      }
    }
    for (const market of orderedActiveMarkets(filteredUniverse(input.universe, selected)).map(({ symbol }) => symbol)) {
      const values = input.marketValues[market];
      if (!values) {
        warnings.add('missing_market_coverage');
        continue;
      }
      if (!values['market.price']) warnings.add('missing_market_coverage');
    }
    for (const [market, values] of Object.entries(input.marketValues)) {
      if (!selected.has(market)) continue;
      representedMarkets.add(market);
      if (Object.values(values).some((value) => value.quality.status === 'stale')) {
        warnings.add(`stale_data:${market}`);
      }
    }
  }
  if ([...selected].some((market) => !representedMarkets.has(market))) {
    warnings.add('missing_market_coverage');
  }
  return Object.freeze([...warnings].sort());
}

function validateFrameUniverseTimes(inputs: BacktestRequest['inputs']): void {
  for (const input of inputs) {
    const observedAt = Date.parse(input.universe.observedAt);
    const frameTime = Date.parse(input.occurredAt);
    const evaluationTime = Date.parse(
      input.triggerInput.kind === 'event'
        ? input.triggerInput.event.occurredAt
        : input.triggerInput.occurredAt,
    );
    if (!Number.isFinite(observedAt)
      || !Number.isFinite(frameTime)
      || !Number.isFinite(evaluationTime)
      || observedAt > frameTime
      || observedAt > evaluationTime) {
      throw new Error('BACKTEST_FRAME_UNIVERSE_TIME_INVALID');
    }
  }
}
