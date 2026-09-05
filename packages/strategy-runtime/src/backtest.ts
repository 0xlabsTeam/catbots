import { createHash } from 'node:crypto';

import type { AuditEvent } from './audit-trace';
import type { BacktestAssumptions, SimulationLedgerEntry } from './backtest-types';
import { createBuiltinRegistry } from './builtins';
import { createEvaluationContext, type EvaluationValue } from './evaluation-context';
import { validateStrategy } from './graph-validator';
import { calculateBacktestMetrics, type BacktestMetrics, type EquityPoint } from './metrics';
import { evaluateTrigger } from './runtime';
import { SimulatedExecutionAdapter } from './simulated-adapter';
import { SimulationClock, type TimedSimulationInput } from './simulation-clock';
import {
  serializeCanonicalJson,
  serializeStrategyDocument,
  type JsonValue,
  type StrategyDocument,
} from './strategy-schema';
import type { TriggerInput } from './triggers';

export type BacktestInput = TimedSimulationInput & {
  triggerNodeId: string;
  triggerInput: TriggerInput;
  values: Record<string, EvaluationValue<unknown>>;
  fundingRate?: number;
};

export type BacktestProgress = Readonly<{
  phase: 'validating' | 'replaying' | 'calculating' | 'completed';
  completed: number;
  total: number;
}>;

export type BacktestRequest = {
  strategy: StrategyDocument;
  market: string;
  range: { from: string; to: string };
  assumptions: BacktestAssumptions;
  inputs: BacktestInput[];
  shouldCancel?: () => boolean;
  onProgress?: (progress: BacktestProgress) => void;
};

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
  equityCurve: readonly EquityPoint[];
  trades: readonly SimulationLedgerEntry[];
  traces: readonly (readonly AuditEvent[])[];
  warnings: readonly string[];
  serializedArtifact: string;
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

function warningsFor(inputs: readonly BacktestInput[]): readonly string[] {
  const warnings: string[] = [];
  if (inputs.length < 2) warnings.push('insufficient_history');
  if (inputs.some((input) => Object.values(input.values).some((value) => value.quality.status === 'stale'))) {
    warnings.push('stale_data');
  }
  return Object.freeze(warnings);
}

export function runBacktest(request: BacktestRequest): BacktestResult {
  const total = request.inputs.length;
  request.onProgress?.({ phase: 'validating', completed: 0, total });
  const validation = validateStrategy(request.strategy, createBuiltinRegistry());
  if (!validation.valid) {
    throw new Error(`Backtest strategy is invalid: ${validation.errors.map((error) => error.code).join(', ')}`);
  }

  const clock = new SimulationClock(request.range.from);
  const orderedInputs = clock.order(request.inputs);
  const adapter = new SimulatedExecutionAdapter({ market: request.market, assumptions: request.assumptions });
  const equityCurve: EquityPoint[] = [{ timestamp: clock.now(), equity: request.assumptions.startingCapital }];
  const traces: (readonly AuditEvent[])[] = [];
  let status: 'completed' | 'cancelled' = 'completed';
  request.onProgress?.({ phase: 'replaying', completed: 0, total });

  for (const [index, input] of orderedInputs.entries()) {
    if (request.shouldCancel?.()) {
      status = 'cancelled';
      break;
    }
    clock.advanceTo(input.occurredAt);
    adapter.markToMarket(createEvaluationContext({
      evaluatedAt: clock.now(),
      currentMarket: request.market,
      values: input.values,
    }));
    if (input.fundingRate !== undefined) {
      adapter.applyFunding(input.fundingRate, createEvaluationContext({
        evaluatedAt: clock.now(),
        currentMarket: request.market,
        values: input.values,
      }));
    }
    const before = adapter.snapshot();
    const context = createEvaluationContext({
      evaluatedAt: clock.now(),
      currentMarket: request.market,
      ...(input.triggerInput.kind === 'event' ? { triggerEvent: input.triggerInput.event } : {}),
      values: {
        ...input.values,
        'account.positions': simulationValue(before.positions as unknown as JsonValue, clock.now(), `positions:${index}:${canonical(before.positions)}`),
        'account.equity': simulationValue(Number(before.equity), clock.now(), `equity:${index}:${before.equity}`),
      },
    });
    const evaluation = evaluateTrigger({
      compiled: validation.compiled,
      triggerNodeId: input.triggerNodeId,
      triggerInput: input.triggerInput,
      context,
      deployment: { id: `backtest:${request.strategy.strategy.id}:v${request.strategy.strategy.version}`, mode: 'backtest' },
      execution: adapter,
    });
    traces.push(evaluation.trace);
    const after = adapter.snapshot();
    equityCurve.push({ timestamp: clock.now(), equity: after.equity });
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
  const warnings = warningsFor(request.inputs);
  const strategyHash = hash(serializeStrategyDocument(request.strategy));
  const inputHash = hash(canonical({ range: request.range, inputs: request.inputs }));
  const assumptionsHash = hash(canonical(request.assumptions));
  const artifactCore = {
    schemaVersion: '1.0',
    status,
    strategyHash,
    inputHash,
    assumptionsHash,
    metrics,
    equityCurve,
    trades,
    traces,
    warnings,
  } as const;
  const artifactHash = hash(canonical(artifactCore));
  const manifest: BacktestManifest = Object.freeze({
    schemaVersion: '1.0', strategyHash, inputHash, assumptionsHash, artifactHash,
  });
  const serializedArtifact = canonical({ ...artifactCore, manifest });
  request.onProgress?.({ phase: 'completed', completed: traces.length, total });

  return Object.freeze({
    status,
    manifest,
    metrics,
    equityCurve: Object.freeze(equityCurve),
    trades: Object.freeze(trades),
    traces: Object.freeze(traces),
    warnings,
    serializedArtifact,
  });
}
