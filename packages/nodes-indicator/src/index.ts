import { z } from 'zod';
import { definePackage, ready, unavailable, type Candle, type FlowDefinition } from '@catbots/node-kit';
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
  evaluate(input,config){
    const bars=input.candles.value as Candle[];
    if(input.candles.quality!=='ready' || !Array.isArray(bars)) return {outputs:{value:unavailable('number',input.candles.reason??'Candles unavailable')}};
    const p=config.period;const prices=bars.map(bar=>bar.close);
    if(prices.length < p+(kind==='rsi'||kind==='atr'?1:0)) return {outputs:{value:unavailable('number',`Need ${p+(kind==='rsi'||kind==='atr'?1:0)} closed candles`)}};
    let value:number;
    if(kind==='rsi')value=calculateRSI(prices,p)!;
    else if(kind==='sma')value=prices.slice(-p).reduce((a,b)=>a+b,0)/p;
    else if(kind==='ema'){value=prices.slice(0,p).reduce((a,b)=>a+b,0)/p;for(const price of prices.slice(p))value+=(price-value)*2/(p+1);}
    else{const ranges=bars.slice(1).map((bar,i)=>Math.max(bar.high-bar.low,Math.abs(bar.high-bars[i].close),Math.abs(bar.low-bars[i].close)));value=ranges.slice(0,p).reduce((a,b)=>a+b,0)/p;for(const range of ranges.slice(p))value=(value*(p-1)+range)/p;}
    return {outputs:{value:ready('number',value)}};
  },
}));
export const indicatorPackage=definePackage('@catbots/nodes-indicator',definitions);
