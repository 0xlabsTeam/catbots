import type { JsonValue } from './strategy-schema';
import type { RiskLimits } from '@catbots/contracts';
import type { EvaluationValue } from './evaluation-context';
import type { MarketUniverseSnapshot } from './market-universe';
import type { TimedSimulationInput } from './simulation-clock';

export type BacktestAssumptions = Readonly<{
  startingCapital: string;
  feeRateBps: number;
  slippageBps: number;
  latencyMs: number;
  partialFillRatio: number;
  maintenanceMarginRate: number;
  riskLimits?: RiskLimits;
}>;

export type SimulatedPosition = Readonly<{
  market: string;
  side: 'long' | 'short';
  quantity: string;
  entryPrice: string;
  leverage: string;
}>;

export type SimulationLedgerEntry = Readonly<{
  type: 'fill' | 'funding' | 'liquidation';
  timestamp: string;
  market: string;
  [key: string]: JsonValue;
}>;

export type SimulationSnapshot = Readonly<{
  cash: string;
  equity: string;
  positions: readonly SimulatedPosition[];
  ledger: readonly SimulationLedgerEntry[];
  totalFees: string;
  totalFunding: string;
  realizedPnl: string;
}>;

export type BacktestMarketUniverse =
  | Readonly<{ mode: 'all_available' }>
  | Readonly<{ mode: 'include'; markets: readonly string[] }>;

export type BacktestDatasetCoverage = Readonly<{
  markets: readonly string[];
  from: string;
  to: string;
}>;

export type BacktestFrame = TimedSimulationInput & Readonly<{
  universe: MarketUniverseSnapshot;
  marketValues: Readonly<Record<string, Readonly<Record<string, EvaluationValue<unknown>>>>>;
  fundingRates?: Readonly<Record<string, number>>;
}>;
