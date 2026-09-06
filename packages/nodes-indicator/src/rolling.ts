import type { Candle } from '@catbots/node-kit';
type State={kind:string;period:number;market:string;lastClosed:number;close:number;value:number;gain:number;loss:number};
/** Seed once, then advance only with newly closed bars; never reseed EMA/Wilder on a sliding window. */
export function rollingIndicator(kind:string,bars:Candle[],period:number,market:string,previous:unknown):{value:number;state:State}|undefined {
  const required=period+(['rsi','atr'].includes(kind)?1:0);
  if(bars.length<required)return;
  let state=structuredClone(previous) as State|undefined;
  if(state && (state.kind!==kind||state.period!==period||state.market!==market))throw new Error('Indicator context changed; reset its state');
  if(state && bars.at(-1)!.closedAt<state.lastClosed)throw new Error('Indicator time moved backwards');
  if(kind!=='sma' && state && bars.some(bar=>bar.closedAt>state!.lastClosed) && !bars.some(bar=>bar.closedAt===state!.lastClosed))throw new Error('Indicator history gap; use a finer replay interval or more candles');
  if(kind==='sma'){
    const value=bars.slice(-period).reduce((sum,bar)=>sum+bar.close,0)/period;
    return {value,state:{kind,period,market,lastClosed:bars.at(-1)!.closedAt,close:bars.at(-1)!.close,value,gain:0,loss:0}};
  }
  let start=0;
  if(!state){
    let value=0,gain=0,loss=0;
    if(kind==='ema')value=bars.slice(0,period).reduce((sum,bar)=>sum+bar.close,0)/period;
    else for(let index=1;index<=period;index++){
      const delta=bars[index].close-bars[index-1].close;
      gain+=Math.max(delta,0)/period;loss+=Math.max(-delta,0)/period;
      if(kind==='atr')value+=Math.max(bars[index].high-bars[index].low,Math.abs(bars[index].high-bars[index-1].close),Math.abs(bars[index].low-bars[index-1].close))/period;
    }
    start=required;
    state={kind,period,market,lastClosed:bars[start-1].closedAt,close:bars[start-1].close,value,gain,loss};
  }
  for(const bar of bars.slice(start)){
    if(bar.closedAt<=state.lastClosed)continue;
    const delta=bar.close-state.close;
    if(kind==='ema')state.value+=(bar.close-state.value)*2/(period+1);
    if(kind==='rsi'){state.gain=(state.gain*(period-1)+Math.max(delta,0))/period;state.loss=(state.loss*(period-1)+Math.max(-delta,0))/period;}
    if(kind==='atr')state.value=(state.value*(period-1)+Math.max(bar.high-bar.low,Math.abs(bar.high-state.close),Math.abs(bar.low-state.close)))/period;
    state.lastClosed=bar.closedAt;state.close=bar.close;
  }
  if(kind==='rsi')state.value=state.gain===0&&state.loss===0?50:state.loss===0?100:100-100/(1+state.gain/state.loss);
  return {value:state.value,state};
}
