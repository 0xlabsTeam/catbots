import { createHash } from 'node:crypto';

import type { AuditEvent } from './audit-trace';
import type {
  BacktestAssumptions,
  BacktestDatasetCoverage,
  BacktestFrame,
  BacktestMarketUniverse,
  SimulationLedgerEntry,
  SimulationSnapshot,
} from './backtest-types';
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
import { SimulationClock, type TimedSimulationInput } from './simulation-clock';
import {
  serializeCanonicalJson,
  serializeStrategyDocument,
  type JsonValue,
  type StrategyDocument,
} from './strategy-schema';
import type { TriggerInput } from './triggers';

export type BacktestInput = BacktestFrame & Readonly<{
  triggerNodeId: string;
  triggerInput: TriggerInput;
}>;

export type BacktestProgress = Readonly<{
  phase: 'validating' | 'replaying' | 'calculating' | 'completed';
  completed: number;
  total: number;
}>;

export type BacktestRequest = Readonly<{
  strategy: StrategyDocument;
  marketUniverse: BacktestMarketUniverse;
  datasetCoverage: BacktestDatasetCoverage;
  range: Readonly<{ from: string; to: string }>;
  assumptions: BacktestAssumptions;
  inputs: readonly BacktestInput[];
  shouldCancel?: () => boolean;
  onProgress?: (progress: BacktestProgress) => void;
}>;

export type LegacyBacktestInput = TimedSimulationInput & Readonly<{
  triggerNodeId: string;
  triggerInput: TriggerInput;
  values: Record<string, EvaluationValue<unknown>>;
  fundingRate?: number;
}>;

export type LegacySingleMarketBacktestRequest = Readonly<{
  strategy: StrategyDocument;
  market: string;
  range: Readonly<{ from: string; to: string }>;
  assumptions: BacktestAssumptions;
  inputs: readonly LegacyBacktestInput[];
  shouldCancel?: () => boolean;
  onProgress?: (progress: BacktestProgress) => void;
}>;

export type BacktestManifest = Readonly<{
  schemaVersion: '1.0';
  strategyHash: string;
  inputHash: string;
  assumptionsHash: string;
  artifactHash: string;
}>;

export type BacktestResult = Readonly<{
  status: 'completed' | 'cancelled';
  manifest: BacktestManifest;
  metrics: BacktestMetrics;
  perMarket: readonly PerMarketBacktestMetrics[];
  datasetCoverage: BacktestDatasetCoverage;
  snapshot: SimulationSnapshot;
  equityCurve: readonly EquityPoint[];
  trades: readonly SimulationLedgerEntry[];
  traces: readonly CoordinatedEvaluation[];
  warnings: readonly string[];
  serializedArtifact: string;
}>;

export type LegacySingleMarketBacktestResult = Omit<BacktestResult, 'traces'> & Readonly<{
  traces: readonly (readonly AuditEvent[])[];
}>;

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonical(value: unknown): string {
  return serializeCanonicalJson(value as JsonValue);
}

function simulationValue(value: JsonValue, observedAt: string, identity: string): EvaluationValue {
  return {
    value,
    provider: 'backtest.simulation',
    observedAt,
    freshnessSeconds: 0,
    quality: { status: 'verified' },
    integrityHash: hash(identity),
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
  selection: BacktestMarketUniverse,
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

function hasVerifiedMarketPrice(values: Readonly<Record<string, EvaluationValue<unknown>>>): boolean {
  const price = values['market.price'];
  return price?.quality.status === 'verified';
}

export function runBacktest(request: BacktestRequest): BacktestResult {
  const total = request.inputs.length;
  request.onProgress?.({ phase: 'validating', completed: 0, total });
  const validation = validateStrategy(request.strategy, createBuiltinRegistry());
  if (!validation.valid) {
    throw new Error(`Backtest strategy is invalid: ${validation.errors.map((error) => error.code).join(', ')}`);
  }
  const coverage = normalizeCoverage(request.datasetCoverage);
  const selected = selectedMarkets(request.marketUniverse, coverage);

  const clock = new SimulationClock(request.range.from);
  const orderedInputs = clock.order(request.inputs);
  const adapter = new SimulatedExecutionAdapter({ assumptions: request.assumptions });
  const equityCurve: EquityPoint[] = [{ timestamp: clock.now(), equity: request.assumptions.startingCapital }];
  const marketContributionCurve: MarketContributionPoint[] = [{
    timestamp: clock.now(),
    contributions: Object.freeze(Object.fromEntries([...selected].sort().map((market) => [market, '0']))),
  }];
  const traces: CoordinatedEvaluation[] = [];
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
    const marketContexts = new Map<string, ReturnType<typeof createEvaluationContext>>();
    for (const market of marketsWithValues) {
      const values = input.marketValues[market];
      if (!values || !hasVerifiedMarketPrice(values)) continue;
      const context = createEvaluationContext({ evaluatedAt: clock.now(), currentMarket: market, values });
      marketContexts.set(market, context);
    }
    adapter.markPortfolio([...marketContexts.values()]);
    for (const [market, context] of marketContexts) {
      const fundingRate = input.fundingRates?.[market];
      if (fundingRate !== undefined) adapter.applyFunding(fundingRate, context);
    }

    const coordinated = coordinateEvaluation({
      compiled: validation.compiled,
      triggerNodeId: input.triggerNodeId,
      triggerInput: input.triggerInput,
      universe,
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
              `positions:${index}:${market}:${canonical(before.positions)}`,
            ),
            'account.equity': simulationValue(
              Number(before.equity),
              clock.now(),
              `equity:${index}:${market}:${before.equity}`,
            ),
          },
        });
      },
      deployment: {
        id: `backtest:${request.strategy.strategy.id}:v${request.strategy.strategy.version}`,
        mode: 'backtest',
      },
      execution: adapter,
    });
    traces.push(coordinated);
    equityCurve.push({ timestamp: clock.now(), equity: adapter.snapshot().equity });
    marketContributionCurve.push({
      timestamp: clock.now(),
      contributions: adapter.marketEquityContributions(),
    });
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
  const warnings = warningsFor(request, coverage, selected);
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
  const strategyHash = hash(serializeStrategyDocument(request.strategy));
  const inputHash = hash(canonical({
    marketUniverse: request.marketUniverse,
    datasetCoverage: coverage,
    range: request.range,
    inputs: request.inputs,
  }));
  const assumptionsHash = hash(canonical(request.assumptions));
  const artifactCore = {
    schemaVersion: '1.0', status, strategyHash, inputHash, assumptionsHash, metrics,
    datasetCoverage: coverage, perMarket, snapshot, equityCurve, trades, traces, warnings,
  } as const;
  const artifactHash = hash(canonical(artifactCore));
  const manifest: BacktestManifest = Object.freeze({
    schemaVersion: '1.0', strategyHash, inputHash, assumptionsHash, artifactHash,
  });
  const serializedArtifact = canonical({ ...artifactCore, manifest });
  request.onProgress?.({ phase: 'completed', completed: traces.length, total });

  return Object.freeze({
    status, manifest, metrics, perMarket, datasetCoverage: coverage, snapshot,
    equityCurve: Object.freeze(equityCurve), trades: Object.freeze(trades), traces: Object.freeze(traces),
    warnings, serializedArtifact,
  });
}

export function adaptSingleMarketBacktestRequest(
  request: LegacySingleMarketBacktestRequest,
): BacktestRequest {
  const market = request.market.trim();
  if (market.length === 0) throw new Error('Legacy Backtest market must be non-empty');
  return {
    strategy: request.strategy,
    marketUniverse: { mode: 'include', markets: [market] },
    datasetCoverage: { markets: [market], from: request.range.from, to: request.range.to },
    range: request.range,
    assumptions: request.assumptions,
    inputs: request.inputs.map((input, index) => ({
      occurredAt: input.occurredAt,
      priority: input.priority,
      stableId: input.stableId,
      triggerNodeId: input.triggerNodeId,
      triggerInput: input.triggerInput.kind === 'event'
        ? { kind: 'event', event: { ...input.triggerInput.event, market: input.triggerInput.event.market ?? market } }
        : input.triggerInput,
      universe: {
        dex: 'hyperliquid', revision: `legacy:${index}:${input.stableId}`, observedAt: input.occurredAt,
        markets: [{ symbol: market, active: true, sizeDecimals: 8, maximumLeverage: 1 }],
      },
      marketValues: { [market]: input.values },
      ...(input.fundingRate === undefined ? {} : { fundingRates: { [market]: input.fundingRate } }),
    })),
    ...(request.shouldCancel ? { shouldCancel: request.shouldCancel } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
  };
}

export function runSingleMarketBacktest(
  request: LegacySingleMarketBacktestRequest,
): LegacySingleMarketBacktestResult {
  const result = runBacktest(adaptSingleMarketBacktestRequest(request));
  const traces = Object.freeze(result.traces.flatMap(({ children }) => (
    children.map(({ evaluation }) => evaluation.trace)
  )));
  const artifactCore = {
    schemaVersion: '1.0',
    status: result.status,
    strategyHash: result.manifest.strategyHash,
    inputHash: result.manifest.inputHash,
    assumptionsHash: result.manifest.assumptionsHash,
    metrics: result.metrics,
    datasetCoverage: result.datasetCoverage,
    perMarket: result.perMarket,
    snapshot: result.snapshot,
    equityCurve: result.equityCurve,
    trades: result.trades,
    traces,
    warnings: result.warnings,
  } as const;
  const manifest = Object.freeze({
    ...result.manifest,
    artifactHash: hash(canonical(artifactCore)),
  });
  return Object.freeze({
    ...result,
    manifest,
    traces,
    serializedArtifact: canonical({ ...artifactCore, manifest }),
  });
}
