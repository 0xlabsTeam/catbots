import { writeFileSync, mkdirSync } from 'node:fs';
import { replayFlowBacktest, type FlowDocument } from '../../packages/strategy-runtime/src/index';
import { HistoricalFlowLoader } from '../../apps/desktop/src/main/backtest/history';
import { BacktestCache } from '../../apps/desktop/src/main/backtest/cache';
const destination='/tmp/catbots-sol1m-research'; mkdirSync(destination,{recursive:true});
const end=Math.floor(Date.now()/3600000)*3600000, from=end-72*3600000, split=end-24*3600000;
const settings={market:'SOL-PERP',from:new Date(from).toISOString(),to:new Date(end).toISOString(),timeframe:'1m' as const,startingCapital:1000,feeBps:4.5,slippageBps:2};
function document(fast:number,slow:number,threshold:number,rewardRisk:number):FlowDocument {
 const n=(id:string,type:string,config:Record<string,unknown>={})=>({id,type,version:1,config}); const e=(source:string,sourcePort:string,target:string,targetPort:string)=>({source,sourcePort,target,targetPort});
 return {schemaVersion:'3.0',nodes:[n('minute','trigger.tick'),n('sol_1m','data.candles',{timeframe:'1m',count:100}),n('fast','indicator.ema',{period:fast}),n('slow','indicator.ema',{period:slow}),n('rsi','indicator.rsi',{period:14}),n('atr','indicator.atr',{period:14}),n('long_short','strategy.directional',{quotePerOrder:100,rsiThreshold:threshold,stopAtr:2,rewardRisk,minAtrPercent:0.08,maxHoldMinutes:30,cooldownMinutes:5})],edges:[e('minute','tick','sol_1m','tick'),...['fast','slow','rsi','atr'].flatMap(id=>[e('sol_1m','candles',id,'candles'),e(id,'value','long_short',id)])]};
}
const loader=new HistoricalFlowLoader(new BacktestCache(`${destination}/cache`));
const data=await loader.load(document(9,21,55,2),settings,AbortSignal.timeout(60000));
writeFileSync(`${destination}/data.json`,JSON.stringify(data));
const summarize=(r:ReturnType<typeof replayFlowBacktest>)=>({net:r.finalEquity-r.settings.startingCapital,returnPercent:r.returnPercent,drawdown:r.maxDrawdownPercent,fees:r.fees,funding:r.funding,fills:r.fills.length,closed:r.fills.filter(f=>f.reduceOnly).length,longEntries:r.fills.filter(f=>!f.reduceOnly&&f.side==='buy').length,shortEntries:r.fills.filter(f=>!f.reduceOnly&&f.side==='sell').length,rejected:r.rejectedOrders,endingPosition:r.position.quantity});
// Freeze the candidate set before opening the final 24 hours. Never select on holdout.
const candidates=[];
for(const [fast,slow] of [[5,13],[9,21],[12,36]])for(const threshold of [50,55,60])for(const rewardRisk of [1.5,2,3]){
 const flow=document(fast,slow,threshold,rewardRisk);
 const result=replayFlowBacktest(flow,{...settings,to:new Date(split).toISOString()},data);
 candidates.push({fast,slow,threshold,rewardRisk,flow,train:summarize(result)});
}
candidates.sort((a,b)=>b.train.net-a.train.net);
const selected=candidates.find(c=>c.train.closed>=10&&c.train.rejected===0)??candidates[0];
const holdoutSettings={...settings,from:new Date(split).toISOString()};
const holdout=replayFlowBacktest(selected.flow,holdoutSettings,data);
const stress=replayFlowBacktest(selected.flow,{...holdoutSettings,slippageBps:5},data);
const report={method:'27 candidates ranked on first 48h only; winner evaluated once on untouched final 24h. Stress uses same frozen winner.',settings,split:new Date(split).toISOString(),selected,holdout:summarize(holdout),stress:summarize(stress),candidates:candidates.map(({flow,...entry})=>entry)};
writeFileSync(`${destination}/report.json`,JSON.stringify(report,null,2));writeFileSync(`${destination}/workflow.json`,JSON.stringify(selected.flow,null,2));writeFileSync(`${destination}/holdout.json`,JSON.stringify(holdout));
console.log(JSON.stringify({...report,candidates:undefined,selected:{...selected,flow:undefined}},null,2));
