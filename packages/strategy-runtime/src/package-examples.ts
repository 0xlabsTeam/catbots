import type { FlowDocument, FlowContext } from '@catbots/node-kit';
export type PackageExample = 'dca'|'grid'|'smart_order';
export function createPackageExample(example:PackageExample):FlowDocument {
  const config=example==='dca'?{quotePerOrder:100,takeProfitPercent:2,stopLossPercent:20,maxNotional:500,extraStepPercent:5,maxExtraOrders:2}:example==='grid'?{quotePerOrder:100,takeProfitPercent:2,stopLossPercent:20,maxNotional:500,levels:3,stepPercent:5}:{quantity:2.5,sliceQuantity:1,maxNotional:500};
  return {schemaVersion:'3.0',nodes:[
    {id:'tick',type:'trigger.tick',version:1,config:{}},
    {id:'candles',type:'data.candles',version:1,config:{timeframe:'5m'}},
    {id:'rsi',type:'indicator.rsi',version:1,config:{period:14}},
    {id:'threshold',type:'process.number',version:1,config:{value:30}},
    {id:'entry',type:'condition.compare',version:1,config:{operator:'lt'}},
    {id:'strategy',type:`strategy.${example}`,version:1,config},
    {id:'debug',type:'output.number',version:1,config:{}},
  ],edges:[
    {source:'tick',sourcePort:'tick',target:'candles',targetPort:'tick'},
    {source:'candles',sourcePort:'candles',target:'rsi',targetPort:'candles'},
    {source:'rsi',sourcePort:'value',target:'entry',targetPort:'left'},
    {source:'threshold',sourcePort:'value',target:'entry',targetPort:'right'},
    {source:'entry',sourcePort:'result',target:'strategy',targetPort:'signal'},
    {source:'rsi',sourcePort:'value',target:'debug',targetPort:'value'},
  ]};
}
/** Synthetic closed candles, never exchange data. */
export function exampleContext(deploymentId:string,run:number,price:number):FlowContext {
  return {deploymentId,runId:`step-${run}`,market:'SIM-PERP',at:Date.UTC(2026,0,1)+run*300000,price,equity:1000,
    candles:{'5m':Array.from({length:30},(_,i)=>({closedAt:Date.UTC(2026,0,1)+(run-30+i)*300000,open:130-i,high:131-i,low:129-i,close:130-i,volume:100}))},fills:[],cancelledOrderIds:[]};
}
