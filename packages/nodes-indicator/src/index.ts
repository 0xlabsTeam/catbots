import { rollingIndicator } from './rolling';
import { z } from 'zod';
import { definePackage, ready, unavailable, type Candle, type FlowDefinition, type ExecutionItem, validateValue } from '@catbots/node-kit';
export function calculateRSI(prices: number[], period: number): number | undefined {
  if (prices.length <= period) return undefined;
  let gain=0, loss=0;
  for(let i=1;i<=period;i++){const delta=prices[i]-prices[i-1];gain+=Math.max(0,delta);loss+=Math.max(0,-delta);}
  gain/=period;loss/=period;
  for(let i=period+1;i<prices.length;i++){const delta=prices[i]-prices[i-1];gain=(gain*(period-1)+Math.max(0,delta))/period;loss=(loss*(period-1)+Math.max(0,-delta))/period;}
  return gain===0 && loss===0 ? 50 : loss===0 ? 100 : 100-100/(1+gain/loss);
}
const definitions: FlowDefinition[] = ['rsi','ema','sma','atr'].map(kind => ({
  type: `indicator.${kind}`, version:1, category:'indicator', title:kind.toUpperCase(),
  config:z.object({period:z.number().int().min(2).max(1000).default(14)}).strict(), inputs:{candles:'candles'}, outputs:{value:'number'},
  evaluate(input,config,context,previous){
    const bars=input.candles.value as Candle[];
    if(input.candles.quality!=='ready' || !Array.isArray(bars)) return {outputs:{value:unavailable('number',input.candles.reason??'Candles unavailable')}};
    const result=rollingIndicator(kind,bars,config.period,context.market,previous);
    return result?{outputs:{value:ready('number',result.value)},state:result.state}:{outputs:{value:unavailable('number',`Need ${config.period+(kind==='rsi'||kind==='atr'?1:0)} closed candles`)}};
  },
}));
export const indicatorPackage = definePackage('@catbots/nodes-indicator', [...definitions, ...definitions.map(definition => ({
  type: `${definition.type}_items`, version: 1, category: 'indicator' as const, title: `${definition.title} · Items`,
  config: definition.config, inputs: { main: 'items' as const }, outputs: { main: 'items' as const },
  evaluate(input, config, context, previous) {
    const states = structuredClone((previous ?? {}) as Record<string, unknown>);
    const result: ExecutionItem[] = [];
    for (const item of input.main.value as ExecutionItem[]) {
      if (item.json.market !== context.market) throw new Error('Indicator market must match the execution market');
      const candles = ready('candles', item.json.candles);
      if (!validateValue(candles, 'candles') || (item.json.candles as Candle[]).some((bar, index, bars) => bar.closedAt > context.at || index > 0 && bar.closedAt <= bars[index - 1].closedAt)) throw new Error('Indicator requires ordered, closed candles');
      const key = `${context.market}:${item.json.timeframe ?? 'candles'}`;
      const evaluated = definition.evaluate({ candles }, config, context, states[key], '');
      const value = evaluated.outputs.value;
      states[key] = evaluated.state;
      if (value.quality !== 'ready') return { outputs: { main: unavailable('items', value.reason!) } };
      result.push({ json: { ...item.json, [definition.type.split('.')[1]]: value.value as number }, pairedItem: item.pairedItem });
    }
    return { outputs: { main: ready('items', result) }, state: states };
  },
} satisfies FlowDefinition))]);
