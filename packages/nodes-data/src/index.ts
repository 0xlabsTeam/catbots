import { z } from 'zod';
import { definePackage, ready, unavailable } from '@catbots/node-kit';
export const dataPackage = definePackage('@catbots/nodes-data', [{
  type: 'data.candles', version: 1, category: 'data', title: 'Closed candles',
  config: z.object({ timeframe: z.string().regex(/^[1-9]\d*[mhd]$/), count: z.number().int().min(2).max(5000).default(200) }).strict(), inputs: { tick: 'event' }, outputs: { candles: 'candles' },
  evaluate(input, config, context) {
    if (input.tick.value !== true) return { outputs: { candles: unavailable('candles', 'Trigger not active') } };
    const source = context.candles[config.timeframe];
    if (!source) return { outputs: { candles: unavailable('candles', 'No data for this timeframe') } };
    const bars = source.filter(bar => bar.closedAt <= context.at).slice(-config.count);
    if (bars.some((bar,index) => ![bar.closedAt,bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite) || bar.close <= 0 || bar.high < bar.low || (index > 0 && bar.closedAt <= bars[index-1].closedAt))) throw new Error('Invalid candle series');
    return { outputs: { candles: bars.length ? ready('candles', bars) : unavailable('candles', 'No closed candles') } };
  },
}, ...(['price','equity'] as const).map(field => ({
  type: `data.${field}`, version: 1, category: 'data' as const, title: field === 'price' ? 'Market price' : 'Account equity', config: z.object({}).strict(), inputs: {}, outputs: { value: 'number' as const },
  evaluate: (_input: unknown, _config: unknown, context: import('@catbots/node-kit').FlowContext) => ({ outputs: { value: Number.isFinite(context[field]) && context[field] > 0 ? ready('number', context[field]) : unavailable('number', `Invalid ${field}`) } }),
}))]);
