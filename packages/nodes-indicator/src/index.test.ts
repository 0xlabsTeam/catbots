import { expect, it } from 'vitest';
import { calculateRSI, indicatorPackage } from './index';
import type { FlowContext } from '@catbots/node-kit';
it('uses Wilder RSI warmup, handles flat/up/down series',()=>{
  expect(calculateRSI([1,2],2)).toBeUndefined();
  expect(calculateRSI([1,2,3],2)).toBe(100);
  expect(calculateRSI([3,2,1],2)).toBe(0);
  expect(calculateRSI([2,2,2],2)).toBe(50);
  expect(calculateRSI([1,2,1,2],2)).toBeCloseTo(75);
});
it.each([['sma',4],['ema',4],['atr',2]] as const)('calculates %s from deterministic candles',(kind,expected)=>{
  const definition=indicatorPackage.definitions.find(d=>d.type===`indicator.${kind}`)!;
  const candles=[1,2,3,4,5].map((close,i)=>({closedAt:i,open:close,close,high:close+1,low:close-1,volume:1}));
  const result=definition.evaluate({candles:{type:'candles',quality:'ready',value:candles}},{period:3},{} as FlowContext,undefined,'test');
  expect(result.outputs.value.value).toBeCloseTo(expected);
});
