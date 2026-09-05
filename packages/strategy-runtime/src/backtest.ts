import { createHash } from 'node:crypto';

import type { AuditEvent } from './audit-trace';
import { replayBacktest } from './backtest-replay';
import type {
  BacktestAssumptions,
  BacktestDatasetCoverage,
  BacktestFrame,
  BacktestMarketUniverse,
  SimulationLedgerEntry,
  SimulationSnapshot,
} from './backtest-types';
import type { EvaluationValue } from './evaluation-context';
import type { CoordinatedEvaluation } from './evaluation-coordinator';
import {
  type BacktestMetrics,
  type EquityPoint,
  type PerMarketBacktestMetrics,
} from './metrics';
import type { TimedSimulationInput } from './simulation-clock';
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

export function runBacktest(request: BacktestRequest): BacktestResult {
  const replay = replayBacktest(request, hash);
  const {
    status, metrics, datasetCoverage: coverage, perMarket, snapshot, equityCurve, trades, traces, warnings,
  } = replay;
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
  request.onProgress?.({ phase: 'completed', completed: traces.length, total: request.inputs.length });

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
        markets: [{ symbol: market, active: true, sizeDecimals: 8, maximumLeverage: 50 }],
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
