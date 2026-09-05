export type EquityPoint = Readonly<{ timestamp: string; equity: string }>;
export type ClosedTrade = Readonly<{ market?: string; realizedPnl: string }>;
export type MarketContributionPoint = Readonly<{
  timestamp: string;
  contributions: Readonly<Record<string, string>>;
}>;

export type BacktestMetrics = Readonly<{
  returnPercent: number;
  maximumDrawdownPercent: number;
  sharpeLike: number;
  winRatePercent: number;
  tradeCount: number;
  fees: string;
  funding: string;
  endingEquity: string;
  realizedPnl: string;
}>;

export type PerMarketBacktestMetrics = Readonly<{
  market: string;
  realizedPnl: string;
  tradeCount: number;
  winRatePercent: number;
  drawdownContributionPercent: number;
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

function decimal(value: number): string {
  const normalized = Math.abs(value) < 0.000000005 ? 0 : value;
  return Number(normalized.toFixed(8)).toString();
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
    endingEquity: input.equityCurve.at(-1)?.equity ?? input.startingCapital,
    realizedPnl: decimal(realized.reduce((total, value) => total + value, 0)),
  });
}

export type PerMarketBacktestMetricInput = Readonly<{
  startingCapital: string;
  markets: readonly string[];
  equityCurve: readonly EquityPoint[];
  marketContributionCurve: readonly MarketContributionPoint[];
  closedTrades: readonly Readonly<{ market: string; realizedPnl: string }>[];
}>;

export function calculatePerMarketBacktestMetrics(
  input: PerMarketBacktestMetricInput,
): readonly PerMarketBacktestMetrics[] {
  const startingCapital = finiteDecimal(input.startingCapital, 'Starting capital');
  if (startingCapital <= 0) throw new Error('Starting capital must be positive');
  if (input.marketContributionCurve.length !== input.equityCurve.length) {
    throw new Error('Market contribution curve must align with the equity curve');
  }
  const markets = [...input.markets].sort();
  if (markets.some((market) => market.length === 0) || new Set(markets).size !== markets.length) {
    throw new Error('Per-market metric markets must be non-empty and unique');
  }

  let peak = startingCapital;
  let peakIndex = 0;
  let drawdownPeakIndex = 0;
  let drawdownTroughIndex = 0;
  let maximumDrawdown = 0;
  input.equityCurve.forEach((point, index) => {
    const equity = finiteDecimal(point.equity, 'Equity');
    if (equity > peak) {
      peak = equity;
      peakIndex = index;
    }
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    if (drawdown > maximumDrawdown) {
      maximumDrawdown = drawdown;
      drawdownPeakIndex = peakIndex;
      drawdownTroughIndex = index;
    }
  });
  const drawdownPeak = finiteDecimal(
    input.equityCurve[drawdownPeakIndex]?.equity ?? input.startingCapital,
    'Drawdown peak',
  );

  return Object.freeze(markets.map((market) => {
    const realized = input.closedTrades
      .filter((trade) => trade.market === market)
      .map((trade) => finiteDecimal(trade.realizedPnl, 'Realized PnL'));
    const peakContribution = finiteDecimal(
      input.marketContributionCurve[drawdownPeakIndex]?.contributions[market] ?? '0',
      'Market contribution',
    );
    const troughContribution = finiteDecimal(
      input.marketContributionCurve[drawdownTroughIndex]?.contributions[market] ?? '0',
      'Market contribution',
    );
    const lossesInDrawdownWindow = Math.max(0, peakContribution - troughContribution);
    return Object.freeze({
      market,
      realizedPnl: decimal(realized.reduce((total, value) => total + value, 0)),
      tradeCount: realized.length,
      winRatePercent: realized.length === 0
        ? 0
        : round(realized.filter((value) => value > 0).length / realized.length * 100),
      drawdownContributionPercent: drawdownPeak === 0
        ? 0
        : round(lossesInDrawdownWindow / drawdownPeak * 100),
    });
  }));
}
