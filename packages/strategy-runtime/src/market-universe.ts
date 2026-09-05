export type MarketUniverseMarket = Readonly<{
  symbol: string;
  active: boolean;
  sizeDecimals: number;
  maximumLeverage: number;
}>;

export type MarketUniverseSnapshot = Readonly<{
  dex: 'hyperliquid';
  revision: string;
  observedAt: string;
  markets: readonly MarketUniverseMarket[];
}>;

export function normalizeMarketSymbol(symbol: string): string {
  const normalized = symbol.trim();
  if (normalized.length === 0) throw new Error('Market symbol must be non-empty');
  return normalized;
}

export function orderedActiveMarkets(universe: MarketUniverseSnapshot): readonly MarketUniverseMarket[] {
  return Object.freeze(universe.markets
    .filter(({ active }) => active)
    .map((market) => Object.freeze({ ...market, symbol: normalizeMarketSymbol(market.symbol) }))
    .sort((left, right) => left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0));
}
