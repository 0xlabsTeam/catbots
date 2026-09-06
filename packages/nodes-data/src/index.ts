import { z } from 'zod';
import { definePackage, ready, unavailable, type ExecutionItem } from '@catbots/node-kit';
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
}, {
  type: 'data.candle_items', version: 1, category: 'data', title: 'Get market candles',
  config: z.object({ timeframe: z.string().regex(/^[1-9]\d*[mhd]$/), count: z.number().int().min(2).max(5000).default(200) }).strict(), inputs: { main: 'items' }, outputs: { main: 'items' },
  evaluate(input, config, context) {
    const records = input.main.value as ExecutionItem[];
    if (records.some(item => item.json.market !== context.market)) throw new Error('Market data must match the execution market');
    const output = dataPackage.definitions[0].evaluate({ tick: ready('event', true) }, config, context, undefined, '').outputs.candles;
    return { outputs: { main: output.quality === 'ready' ? ready('items', records.map(item => ({ json: { ...item.json, candles: output.value, timeframe: config.timeframe }, pairedItem: item.pairedItem }))) : unavailable('items', output.reason!) } };
  },
}, ...(['price','equity'] as const).map(field => ({
  type: `data.${field}`, version: 1, category: 'data' as const, title: field === 'price' ? 'Market price' : 'Account equity', config: z.object({}).strict(), inputs: {}, outputs: { value: 'number' as const },
  evaluate: (_input: unknown, _config: unknown, context: import('@catbots/node-kit').FlowContext) => ({ outputs: { value: Number.isFinite(context[field]) && context[field] > 0 ? ready('number', context[field]) : unavailable('number', `Invalid ${field}`) } }),
}))]);
