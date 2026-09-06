import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionAuthorization } from '../src/main/connections/authorization';
import type { ExchangeConnection } from '@catbots/contracts';
const directories:string[]=[];afterEach(()=>directories.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
const setup=(environment:'production'|'testnet')=>{const owner=privateKeyToAccount(generatePrivateKey());const dir=mkdtempSync(join(tmpdir(),'auth-test-'));directories.push(dir);const path=join(dir,'keys.enc');const connection:ExchangeConnection={id:'00000000-0000-4000-8000-000000000001',adapterId:'hyperliquid',name:'Test',owner:owner.address.toLowerCase(),environment,accounts:[],permission:'view-only',updatedAt:new Date().toISOString()};const cipher={encrypt:(v:string)=>Buffer.from(Buffer.from(v).map(byte=>byte^137)),decrypt:(v:Buffer)=>Buffer.from(v.map(byte=>byte^137)).toString()};return {owner,path,connection,cipher};};
it.each(['production','testnet'] as const)('signs only the expected owner and routes %s authorization to the correct host',async(environment)=>{
 const {owner,path,connection,cipher}=setup(environment);let agent='';
 const request=vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/exchange')?{status:'ok'}:[{address:agent,validUntil:Date.now()+100000}]}));
 const service=new ConnectionAuthorization(path,cipher,request as never);const challenge=service.prepare(connection);agent=challenge.typedData.message.agentAddress;
 expect(challenge.typedData.message.hyperliquidChain).toBe(environment==='production'?'Mainnet':'Testnet');
 expect(JSON.stringify(challenge)).not.toContain('privateKey');expect(readFileSync(path).toString()).not.toContain('"key"');
 const signature=await owner.signTypedData(challenge.typedData);expect(await service.complete(connection,signature)).toBe(true);
 expect(request.mock.calls[0][0]).toBe(environment==='production'?'https://api.hyperliquid.xyz/exchange':'https://api.hyperliquid-testnet.xyz/exchange');
 expect(await new ConnectionAuthorization(path,cipher,request as never).verify(connection)).toBe(true);
});
it('rejects signatures from a different main wallet before contacting the exchange',async()=>{
 const {path,connection,cipher}=setup('testnet');const request=vi.fn();const service=new ConnectionAuthorization(path,cipher,request);const challenge=service.prepare(connection);
 const wrong=privateKeyToAccount(generatePrivateKey());await expect(service.complete(connection,await wrong.signTypedData(challenge.typedData))).rejects.toThrow('CONNECTION_WALLET_MISMATCH');expect(request).not.toHaveBeenCalled();
});
it('does not confirm expired or revoked agents',async()=>{
 const {path,connection,cipher}=setup('testnet');let agent='';const request=vi.fn(async()=>({ok:true,json:async()=>[{address:agent,validUntil:Date.now()-1}]}));const service=new ConnectionAuthorization(path,cipher,request as never);agent=service.prepare(connection).typedData.message.agentAddress;expect(await service.verify(connection)).toBe(false);
});
it('fails closed if secure key persistence fails',()=>{
 const {path,connection}=setup('testnet');const service=new ConnectionAuthorization(path,{encrypt:()=>{throw new Error('Keychain locked');},decrypt:()=>''});expect(()=>service.prepare(connection)).toThrow('CONNECTION_KEYSTORE_UNAVAILABLE');
});

it('returns safe actionable codes for exchange rejection without echoing response secrets',async()=>{
 const {owner,path,connection,cipher}=setup('testnet');
 const request=vi.fn(async()=>({ok:true,json:async()=>({status:'err',response:'User does not exist; must deposit before approving. sensitive-response-content'})}));
 const service=new ConnectionAuthorization(path,cipher,request as never);const challenge=service.prepare(connection);
 await expect(service.complete(connection,await owner.signTypedData(challenge.typedData))).rejects.toMatchObject({code:'CONNECTION_ACCOUNT_NOT_ACTIVATED',message:'CONNECTION_ACCOUNT_NOT_ACTIVATED'});
});

it('includes the explicit EIP-712 domain required by browser wallet RPC and preserves an outstanding challenge',async()=>{
 const {path,connection,cipher}=setup('testnet');
 const service=new ConnectionAuthorization(path,cipher);
 const first=service.prepare(connection);
 expect(first.typedData.types.EIP712Domain).toEqual([
  {name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'},
 ]);
 expect(service.prepare(connection).typedData).toEqual(first.typedData);
});
