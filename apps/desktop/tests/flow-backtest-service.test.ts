import { afterEach,describe,it,expect,vi } from 'vitest';
import { mkdtemp,rm,writeFile,readdir,utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacktestCache,hash } from '../src/main/backtest/cache';
import { HistoricalFlowLoader } from '../src/main/backtest/history';
import { FlowBacktestService } from '../src/main/backtest/service';
import { replayFlowBacktest } from '@catbots/strategy-runtime';
import type { ChatFlowDraft,FlowBacktestSettings } from '@catbots/contracts';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function directory(){const path=await mkdtemp(join(tmpdir(),'catbots-backtest-'));dirs.push(path);return path;}
const hour=3600000,settings:FlowBacktestSettings={market:'ETH-PERP',from:new Date(0).toISOString(),to:new Date(3*hour).toISOString(),timeframe:'1h',startingCapital:1000,feeBps:3.5,slippageBps:1};
const draft:ChatFlowDraft={botId:'00000000-0000-4000-8000-000000000001',version:1,status:'valid',updatedAt:new Date(0).toISOString(),document:{schemaVersion:'3.0',nodes:[{id:'tick',type:'trigger.items',version:1,config:{}}],edges:[]}};
function provider(){return vi.fn(async(_url:unknown,options:any)=>{const body=JSON.parse(options.body);return new Response(JSON.stringify(body.type==='candleSnapshot'?[-2,-1,0,1,2].map(index=>({t:index*hour,T:(index+1)*hour-1,s:'ETH',i:'1h',o:'100',h:'100',l:'100',c:'100',v:'10'})):[0,hour,2*hour].filter(time=>time+13>=body.startTime).map(time=>({coin:'ETH',time:time+13,fundingRate:'0'}))));});}
async function finished(service:FlowBacktestService,id:string){let job;await vi.waitFor(()=>{job=service.command({action:'backtest_status',botId:draft.botId,jobId:id});expect(['completed','failed','cancelled']).toContain(job.status);},{timeout:5000});return job! as ReturnType<FlowBacktestService['command']>;}
describe('historical data and result cache',()=>{
  it('reads checksummed cache, expires TTL and ignores corrupt values',async()=>{const dir=await directory(),cache=new BacktestCache(dir),key=hash({a:1});await cache.set(key,{ok:true});expect(await cache.get(key,1000)).toEqual({ok:true});await utimes(join(dir,`${key}.json`),new Date(0),new Date(0));expect(await cache.get(key,1000)).toBeUndefined();await writeFile(join(dir,`${key}.json`),'{broken');expect(await cache.get(key,1000)).toBeUndefined();});
  it('bounds disk entry count',async()=>{const dir=await directory(),cache=new BacktestCache(dir);for(let i=0;i<36;i++)await cache.set(hash(i),{i});expect((await readdir(dir)).length).toBe(32);});
  it('coalesces history requests and cancelling a waiter does not cancel other consumers',async()=>{const request=provider(),loader=new HistoricalFlowLoader(new BacktestCache(await directory()),request);const controller=new AbortController();const first=loader.load(draft.document,settings,controller.signal);const second=loader.load(draft.document,settings,new AbortController().signal);controller.abort();await expect(first).rejects.toThrow();expect((await second).candles['1h']).toHaveLength(5);const calls=request.mock.calls.length;await loader.load(draft.document,settings,new AbortController().signal);expect(request).toHaveBeenCalledTimes(calls);});
  it('rejects partial data rather than caching successful-looking truncated history',async()=>{const request=vi.fn(async()=>new Response(JSON.stringify([]))),loader=new HistoricalFlowLoader(new BacktestCache(await directory()),request);await expect(loader.load(draft.document,settings,new AbortController().signal)).rejects.toThrow('incomplete');await expect(loader.load(draft.document,settings,new AbortController().signal)).rejects.toThrow();expect(request).toHaveBeenCalledTimes(2);});
  it('caches identical results, invalidates on fees and bypasses on refresh',async()=>{const request=provider(),execute=vi.fn(async(document,options,data)=>replayFlowBacktest(document,options,data));let current=structuredClone(draft);const service=new FlowBacktestService(await directory(),()=>current,execute,request);
    const start=(extra={})=>service.command({action:'backtest_flow',botId:draft.botId,version:1,settings,...extra});
    const one=start(),joined=start();expect(joined.id).toBe(one.id);expect((await finished(service,one.id)).status).toBe('completed');
    const two=await finished(service,start().id);expect(two.cacheHit).toBe(true);expect(execute).toHaveBeenCalledTimes(1);
    const changed=await finished(service,start({settings:{...settings,feeBps:10}}).id);expect(changed.cacheHit).toBe(false);expect(execute).toHaveBeenCalledTimes(2);
    current={...current,version:2,document:{...current.document,nodes:[...current.document.nodes,{id:'constant',type:'process.number',version:1,config:{value:5}}]}};
    expect((await finished(service,start({version:2}).id)).cacheHit).toBe(false);expect(execute).toHaveBeenCalledTimes(3);
    await finished(service,start({version:2,refresh:true}).id);expect(execute).toHaveBeenCalledTimes(4);service.dispose();
  });
  it('cancels active jobs and isolates job IDs by bot',async()=>{const execute=vi.fn((_document,_settings,_data,signal:AbortSignal)=>new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')))));const service=new FlowBacktestService(await directory(),()=>draft,execute,provider());const job=service.command({action:'backtest_flow',botId:draft.botId,version:1,settings});await vi.waitFor(()=>expect(execute).toHaveBeenCalledTimes(1));expect(()=>service.command({action:'backtest_status',botId:'00000000-0000-4000-8000-000000000002',jobId:job.id})).toThrow();expect(service.command({action:'cancel_backtest',botId:draft.botId,jobId:job.id}).status).toBe('cancelled');expect((await finished(service,job.id)).result).toBeUndefined();service.dispose();});
});
