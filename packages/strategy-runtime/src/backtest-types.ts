import type { JsonValue } from './strategy-schema';

export type BacktestAssumptions = Readonly<{
  startingCapital: string;
  feeRateBps: number;
  slippageBps: number;
  latencyMs: number;
  partialFillRatio: number;
  maintenanceMarginRate: number;
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
