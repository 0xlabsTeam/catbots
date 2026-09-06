import { z } from 'zod';
export const MarketSnapshotRequestSchema = z.object({
  action: z.literal('market_snapshot'), market: z.string().regex(/^[A-Z0-9]{1,20}-PERP$/),
  timeframes: z.array(z.enum(['1m','3m','5m','15m','30m','1h','2h','4h','8h','12h','1d','3d'])).max(4).default([]),
}).strict();
export type MarketSnapshot = {
  market: string; source: 'Hyperliquid mainnet'; fetchedAt: string; price: number; funding: number;
  candles: Record<string, { closedAt: number; open: number; high: number; low: number; close: number; volume: number }[]>;
};
