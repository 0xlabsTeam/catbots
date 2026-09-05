import { describe, expect, it } from 'vitest';
import { evaluatePackagedFlow, runtimeNodePackages } from './node-packages';
import type { FlowContext, FlowDocument } from '@catbots/node-kit';
const context:FlowContext={runId:'run-1',deploymentId:'paper-1',market:'SOL-PERP',at:1000,price:100,equity:1000,candles:{},fills:[],cancelledOrderIds:[]};
const signalNodes=[{id:'a',type:'process.number',version:1,config:{value:1}},{id:'b',type:'process.number',version:1,config:{value:2}},{id:'signal',type:'condition.compare',version:1,config:{operator:'lt'}}];
const signalEdges=[{source:'a',sourcePort:'value',target:'signal',targetPort:'left'},{source:'b',sourcePort:'value',target:'signal',targetPort:'right'}];
function strategy(type:string,config:Record<string,unknown>):FlowDocument{return {schemaVersion:'3.0',nodes:[...signalNodes,{id:'deal',type:`strategy.${type}`,version:1,config}],edges:[...signalEdges,{source:'signal',sourcePort:'result',target:'deal',targetPort:'signal'}]};}
const dca=strategy('dca',{quotePerOrder:100,takeProfitPercent:2,stopLossPercent:20,maxNotional:500,extraStepPercent:5,maxExtraOrders:2,volumeMultiplier:1});
const fill=(id:string,order:import('@catbots/node-kit').OrderPlan,price:number,quantity=order.quantity)=>({id,clientOrderId:order.clientOrderId,side:order.side,quantity,price,fee:0});
describe('packaged flow runtime',()=>{
  it('registers all nine package categories without legacy definition changes',()=>{expect(new Set(runtimeNodePackages.flatMap(p=>p.definitions.map(d=>d.category))).size).toBe(9);});
  it('rejects data-type mismatches, missing inputs, cycles and duplicate input wires',()=>{
    const bad=structuredClone(dca);bad.edges[0].sourcePort='missing';expect(()=>evaluatePackagedFlow(bad,context)).toThrow('ports');
    expect(()=>evaluatePackagedFlow({...dca,edges:dca.edges.slice(1)},context)).toThrow('Missing input');
    expect(()=>evaluatePackagedFlow({...dca,edges:[...dca.edges,dca.edges[0]]},context)).toThrow('exactly one');
    const cyclic:FlowDocument={schemaVersion:'3.0',nodes:['a','b'].map(id=>({id,type:'output.number',version:1,config:{}})),edges:[{source:'a',sourcePort:'value',target:'b',targetPort:'value'},{source:'b',sourcePort:'value',target:'a',targetPort:'value'}]};expect(()=>evaluatePackagedFlow(cyclic,context)).toThrow('Cycles');
  });
  it('DCA waits for actual fills, ignores duplicate fills and averages only filled quantities',()=>{
    const first=evaluatePackagedFlow(dca,context);expect(first.orders).toHaveLength(1);expect((first.state.deal as any).lots[0].quantity).toBe(0);
    const event=fill('f1',first.orders[0],100,0.4);
    const partial=evaluatePackagedFlow(dca,{...context,runId:'2',fills:[event]},first.state);expect(partial.orders).toHaveLength(0);expect((partial.state.deal as any).lots[0].quantity).toBe(0.4);
    const replay=evaluatePackagedFlow(dca,{...context,runId:'3',fills:[event]},partial.state);expect(replay.state).toEqual(partial.state);
    const completed=evaluatePackagedFlow(dca,{...context,runId:'4',fills:[fill('f2',first.orders[0],100,0.6)]},partial.state);
    const averaged=evaluatePackagedFlow(dca,{...context,runId:'5',price:95},completed.state);expect(averaged.orders).toHaveLength(1);expect(averaged.orders[0].quantity).toBeCloseTo(100/95);
    expect(()=>evaluatePackagedFlow(dca,{...context,market:'ETH-PERP'},averaged.state)).toThrow('another');
  });
  it('cancels pending entry before exiting and does not repeat stop loss cycles',()=>{
    const first=evaluatePackagedFlow(dca,context);
    const partial=evaluatePackagedFlow(dca,{...context,fills:[fill('part',first.orders[0],100,0.5)],price:75},first.state);
    expect(partial.orders).toEqual([]);expect(partial.cancelOrderIds).toEqual([first.orders[0].clientOrderId]);
    const cancelled=evaluatePackagedFlow(dca,{...context,price:75,cancelledOrderIds:partial.cancelOrderIds},partial.state);expect(cancelled.orders[0]).toMatchObject({side:'sell',quantity:0.5,reduceOnly:true});
    const closed=evaluatePackagedFlow(dca,{...context,price:75,fills:[fill('close',cancelled.orders[0],75)]},cancelled.state);expect((closed.state.deal as any).stage).toBe('completed');expect(closed.orders).toHaveLength(0);
  });
  it('Grid separates inventories and protects a partial fill after cancelling its remainder',()=>{
    const grid=strategy('grid',{quotePerOrder:100,takeProfitPercent:2,stopLossPercent:20,maxNotional:500,levels:3,stepPercent:5});
    const first=evaluatePackagedFlow(grid,context);expect(first.orders.map(o=>o.limitPrice)).toEqual([100,95,90]);
    const part=evaluatePackagedFlow(grid,{...context,fills:[fill('partial',first.orders[0],100,0.25)]},first.state);expect(part.cancelOrderIds).toEqual([first.orders[0].clientOrderId]);
    const cancelled=evaluatePackagedFlow(grid,{...context,cancelledOrderIds:part.cancelOrderIds},part.state);expect(cancelled.orders).toEqual([expect.objectContaining({quantity:0.25,limitPrice:102,purpose:'exit'})]);
  });
  it('Smart Order tracks cumulative fills and proposes a smaller final slice',()=>{
    const smart=strategy('smart_order',{quantity:2.5,sliceQuantity:1,maxNotional:1000});
    const a=evaluatePackagedFlow(smart,context);const b=evaluatePackagedFlow(smart,{...context,fills:[fill('a',a.orders[0],100)]},a.state);const c=evaluatePackagedFlow(smart,{...context,fills:[fill('b',b.orders[0],100)]},b.state);
    expect(c.orders[0].quantity).toBe(0.5);const d=evaluatePackagedFlow(smart,{...context,fills:[fill('c',c.orders[0],100)]},c.state);expect(d.orders).toEqual([]);expect((d.state.deal as any).stage).toBe('completed');
  });
  it('caps outstanding notional and freezes configuration for a strategy instance',()=>{
    const small=strategy('dca',{...dca.nodes[3].config,maxNotional:50});expect(evaluatePackagedFlow(small,context).orders).toHaveLength(0);
    const first=evaluatePackagedFlow(dca,context);expect(()=>evaluatePackagedFlow(small,context,first.state)).toThrow('locked');
  });
  it('retries a cancelled unfilled DCA entry without consuming an extra-order step',()=>{
    const first=evaluatePackagedFlow(dca,context);
    const cancelled=evaluatePackagedFlow(dca,{...context,runId:'retry',cancelledOrderIds:[first.orders[0].clientOrderId]},first.state);
    expect(cancelled.orders).toHaveLength(1);
    expect(cancelled.orders[0].quantity).toBe(1);
    expect(cancelled.orders[0].clientOrderId).not.toBe(first.orders[0].clientOrderId);
    expect((cancelled.state.deal as any).lots).toHaveLength(1);
  });
  it('completes a non-repeating Grid after every level exits',()=>{
    const grid=strategy('grid',{quotePerOrder:100,takeProfitPercent:2,stopLossPercent:20,maxNotional:500,levels:1,stepPercent:5,repeat:false});
    const a=evaluatePackagedFlow(grid,context);
    const b=evaluatePackagedFlow(grid,{...context,fills:[fill('entry',a.orders[0],100)]},a.state);
    const c=evaluatePackagedFlow(grid,{...context,price:102,fills:[fill('exit',b.orders[0],102)]},b.state);
    expect(c.orders).toEqual([]);expect((c.state.deal as any).stage).toBe('completed');
  });
  it('reads only closed candles and returns unavailable during RSI warmup',()=>{
    const doc:FlowDocument={schemaVersion:'3.0',nodes:[{id:'t',type:'trigger.tick',version:1,config:{}},{id:'data',type:'data.candles',version:1,config:{timeframe:'5m'}},{id:'rsi',type:'indicator.rsi',version:1,config:{period:2}}],edges:[{source:'t',sourcePort:'tick',target:'data',targetPort:'tick'},{source:'data',sourcePort:'candles',target:'rsi',targetPort:'candles'}]};
    const candles=[1,2,3,4].map(i=>({closedAt:i*100,open:i,high:i,low:i,close:i,volume:1}));
    const warm=evaluatePackagedFlow(doc,{...context,at:200,candles:{'5m':candles}});expect(warm.trace.at(-1)?.outputs.value.quality).toBe('unavailable');
    const full=evaluatePackagedFlow(doc,{...context,at:300,candles:{'5m':candles}});expect(full.trace.at(-1)?.outputs.value.value).toBe(100);expect((full.trace[1].outputs.candles.value as unknown[]).length).toBe(3);
  });
});
