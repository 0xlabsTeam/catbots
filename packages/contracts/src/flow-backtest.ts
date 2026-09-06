import type { ChatFlowDraft } from './chat-flow';
import { z } from 'zod';
export const FlowBacktestSettingsSchema = z.object({
  market: z.string().regex(/^[A-Z0-9]{1,20}-PERP$/),
  from: z.string().datetime(), to: z.string().datetime(),
  timeframe: z.enum(['1m', '5m', '15m', '1h']),
  startingCapital: z.number().finite().positive().max(1e9),
  feeBps: z.number().finite().min(0).max(100), slippageBps: z.number().finite().min(0).max(100),
}).strict().refine(value => Date.parse(value.to) > Date.parse(value.from), 'End must follow start');
export type FlowBacktestSettings = z.infer<typeof FlowBacktestSettingsSchema>;
export const FlowBacktestCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('backtest_flow'), botId: z.string().uuid(), version: z.number().int().positive(), settings: FlowBacktestSettingsSchema, refresh: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('backtest_status'), botId: z.string().uuid(), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('cancel_backtest'), botId: z.string().uuid(), jobId: z.string().uuid() }).strict(),
]);
export type FlowBacktestTrade = { at: number; orderId: string; side: 'buy' | 'sell'; quantity: number; price: number; fee: number; realizedPnl: number; reduceOnly: boolean };
export type FlowBacktestResult = {
  document: ChatFlowDraft['document']; engineVersion: string; dataHash: string; flowHash: string; settings: FlowBacktestSettings; dataset: { source: string; fetchedAt: string; from: number; to: number; bars: number }; durationMs: number;
  finalEquity: number; returnPercent: number; maxDrawdownPercent: number; fees: number; funding: number; realizedPnl: number; unrealizedPnl: number;
  position: { quantity: number; entryPrice: number }; fills: FlowBacktestTrade[]; rejectedOrders: number; pendingOrders: number;
  equityCurve: { at: number; equity: number }[]; nodeStats: Record<string, { executed: number; skipped: number; unavailable: number }>; warnings: string[];
};
export type FlowBacktestJob = { id: string; botId: string; version: number; status: 'loading' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: number; cacheHit: boolean; error?: string; result?: FlowBacktestResult };
