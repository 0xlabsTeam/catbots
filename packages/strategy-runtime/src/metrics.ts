export type EquityPoint = Readonly<{ timestamp: string; equity: string }>;
export type ClosedTrade = Readonly<{ realizedPnl: string }>;

export type BacktestMetrics = Readonly<{
  returnPercent: number;
  maximumDrawdownPercent: number;
  sharpeLike: number;
  winRatePercent: number;
  tradeCount: number;
  fees: string;
  funding: string;
}>;

export type BacktestMetricInput = Readonly<{
  startingCapital: string;
  equityCurve: readonly EquityPoint[];
  closedTrades: readonly ClosedTrade[];
  totalFees: string;
  totalFunding: string;
}>;

function finiteDecimal(value: string, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
  return result;
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

export function calculateBacktestMetrics(input: BacktestMetricInput): BacktestMetrics {
  const startingCapital = finiteDecimal(input.startingCapital, 'Starting capital');
  if (startingCapital <= 0) throw new Error('Starting capital must be positive');
  const equities = input.equityCurve.map((point) => finiteDecimal(point.equity, 'Equity'));
  const finalEquity = equities.at(-1) ?? startingCapital;
  const returnPercent = (finalEquity / startingCapital - 1) * 100;

  let peak = startingCapital;
  let maximumDrawdown = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    if (peak > 0) maximumDrawdown = Math.max(maximumDrawdown, (peak - equity) / peak * 100);
  }

  const returns: number[] = [];
  for (let index = 1; index < equities.length; index += 1) {
    const previous = equities[index - 1];
    const current = equities[index];
    if (previous !== undefined && current !== undefined && previous !== 0) {
      returns.push(current / previous - 1);
    }
  }
  const mean = returns.length === 0 ? 0 : returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length === 0
    ? 0
    : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const deviation = Math.sqrt(variance);
  const sharpeLike = deviation === 0 ? 0 : mean / deviation * Math.sqrt(returns.length);

  const realized = input.closedTrades.map((trade) => finiteDecimal(trade.realizedPnl, 'Realized PnL'));
  const wins = realized.filter((pnl) => pnl > 0).length;

  return Object.freeze({
    returnPercent: round(returnPercent),
    maximumDrawdownPercent: round(maximumDrawdown),
    sharpeLike: round(sharpeLike),
    winRatePercent: realized.length === 0 ? 0 : round(wins / realized.length * 100),
    tradeCount: realized.length,
    fees: input.totalFees,
    funding: input.totalFunding,
  });
}
