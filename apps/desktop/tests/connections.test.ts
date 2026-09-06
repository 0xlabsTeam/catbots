import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionsService } from '../src/main/connections/service';
import { HyperliquidAdapter, type ExchangeAdapter } from '../src/main/connections/adapters';
const directories:string[]=[];
afterEach(()=>directories.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const file=()=>{const path=mkdtempSync(join(tmpdir(),'connections-'));directories.push(path);return join(path,'saved.json');};
const owner='0x'+'1'.repeat(40),sub='0x'+'2'.repeat(40);
it('discovers main/subaccounts using their real addresses and a fixed environment endpoint',async()=>{
 const request=vi.fn(async(_url:unknown,init:any)=>{const body=JSON.parse(init.body);return {ok:true,json:async()=>body.type==='userAbstraction'?'unifiedAccount':body.type==='spotClearinghouseState'?{balances:[{coin:'USDC',token:0,total:'999.00000000'}]}:body.type==='userRole'?{role:'user'}:body.type==='subAccounts'?[{name:'Trend',subAccountUser:sub}]:{marginSummary:{accountValue:'250'},withdrawable:'200',assetPositions:[{position:{szi:'1'}}]}};});
 const accounts=await new HyperliquidAdapter(request as never).discover(owner,'testnet');
 expect(accounts.map(item=>item.kind)).toEqual(['main','subaccount']);expect(accounts[1]).toMatchObject({equity:'250',withdrawable:'200',positions:1,accountMode:'unifiedAccount',usdcBalance:'999.00000000'});
 expect(request.mock.calls.map(([,init])=>JSON.parse(init.body)).filter(body=>body.type==='clearinghouseState').map(body=>body.user)).toEqual([owner,sub]);
 expect(request.mock.calls.every(([url])=>url==='https://api.hyperliquid-testnet.xyz/info')).toBe(true);
});
it('rejects API-wallet addresses and malformed balances rather than displaying zero',async()=>{
 const request=vi.fn(async()=>({ok:true,json:async()=>({role:'agent'})}));
 await expect(new HyperliquidAdapter(request as never).discover(owner,'production')).rejects.toThrow('main account');
 expect(request).toHaveBeenCalledTimes(1);
});
it('supports another adapter without Hyperliquid address rules and persists across restart',async()=>{
 const adapter:ExchangeAdapter={descriptor:{id:'test-exchange',name:'Test exchange',environments:['production'],authentication:['public-address'],capabilities:{accountDiscovery:true,markets:['spot'],trading:false}},normalizeOwner:value=>value,discover:vi.fn(async()=>[])};
 const path=file(),service=new ConnectionsService(path,[adapter]);
 const input={action:'connect',adapterId:'test-exchange',name:'Personal',environment:'production',owner:'CaseSensitiveAccount'};
 const first=await service.command(input);expect(first.connections[0].owner).toBe('CaseSensitiveAccount');expect(first.connections[0].permission).toBe('view-only');
 const second=await service.command(input);expect(second.connections).toHaveLength(1);
 expect((await new ConnectionsService(path,[adapter]).command({action:'list'})).connections).toEqual(second.connections);
 await expect(service.command({...input,environment:'testnet'})).rejects.toThrow('environment');
});
it('preserves the last successful snapshot when refresh fails',async()=>{
 const adapter:ExchangeAdapter={descriptor:{id:'test',name:'Test',environments:['production'],authentication:['public-address'],capabilities:{accountDiscovery:true,markets:[],trading:false}},normalizeOwner:v=>v,discover:vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))};
 const service=new ConnectionsService(file(),[adapter]);const saved=await service.command({action:'connect',adapterId:'test',name:'One',environment:'production',owner:'x'});
 await expect(service.command({action:'refresh',id:saved.connections[0].id})).rejects.toThrow('offline');
 expect(await service.command({action:'list'})).toEqual(saved);
});
