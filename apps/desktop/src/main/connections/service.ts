import { ConnectionAuthorization } from './authorization';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ConnectionCommandSchema, ExchangeConnectionSchema, type ExchangeConnection, type ConnectionsView } from '@catbots/contracts';
import { HyperliquidAdapter, type ExchangeAdapter } from './adapters';
export class ConnectionsService {
 private connections:ExchangeConnection[]=[];
 constructor(private path:string,private adapters:ExchangeAdapter[]=[new HyperliquidAdapter()],private authorization?:ConnectionAuthorization,private openWalletBrowser?:()=>Promise<void>){
  if(existsSync(path))this.connections=z.array(ExchangeConnectionSchema).max(100).parse(JSON.parse(readFileSync(path,'utf8')));
 }
 private view():ConnectionsView{return structuredClone({adapters:this.adapters.map(adapter=>adapter.descriptor),connections:this.connections});}
 private save(next:ExchangeConnection[]){mkdirSync(dirname(this.path),{recursive:true});const temp=`${this.path}.tmp`;writeFileSync(temp,JSON.stringify(next),{mode:0o600});renameSync(temp,this.path);this.connections=next;}
 async command(raw:unknown):Promise<ConnectionsView>{
  const input=ConnectionCommandSchema.parse(raw);
  if(input.action==='list')return this.view();
  if(input.action==='open_wallet_browser'){if(!this.openWalletBrowser)throw new Error('Wallet browser unavailable');await this.openWalletBrowser();return this.view();}
  if(input.action==='prepare_authorization'||input.action==='complete_authorization'||input.action==='verify_authorization'){
   const connection=this.connections.find(item=>item.id===input.id);if(!connection||!this.authorization)throw new Error('Secure authorization unavailable');
   if(input.action==='prepare_authorization')return {...this.view(),authorization:this.authorization.prepare(connection)};
   const valid=input.action==='complete_authorization'?await this.authorization.complete(connection,input.signature as `0x${string}`):await this.authorization.verify(connection);
   this.save(this.connections.map(item=>item.id===connection.id?{...item,authorizationCheckedAt:new Date().toISOString(),permission:valid?'trading-authorized' as const:'view-only' as const}:item));return this.view();
  }
  if(input.action==='remove'){this.save(this.connections.filter(item=>item.id!==input.id));return this.view();}
  const existing=input.action==='refresh'?this.connections.find(item=>item.id===input.id):undefined;
  if(input.action==='refresh'&&!existing)throw new Error('Connection not found');
  const source=input.action==='connect'?input:existing!;
  const adapter=this.adapters.find(item=>item.descriptor.id===source.adapterId);
  if(!adapter||!adapter.descriptor.environments.includes(source.environment))throw new Error('Adapter or environment unavailable');
  const accounts=await adapter.discover(source.owner,source.environment);
  const owner=adapter.normalizeOwner(source.owner);
  const duplicate=this.connections.find(item=>item.adapterId===source.adapterId&&item.environment===source.environment&&item.owner===owner);
  // A refresh that was removed while fetching must not resurrect the connection.
  if(existing&&!this.connections.some(item=>item.id===existing.id))return this.view();
  const connection:ExchangeConnection={id:existing?.id??duplicate?.id??randomUUID(),adapterId:source.adapterId,name:source.name,environment:source.environment,owner,permission:existing?.permission??duplicate?.permission??'view-only',authorizationCheckedAt:existing?.authorizationCheckedAt??duplicate?.authorizationCheckedAt,accounts,updatedAt:new Date().toISOString()};
  const next=this.connections.filter(item=>item.id!==connection.id);if(next.length>=100)throw new Error('Connection limit reached');
  this.save([...next,connection]);return this.view();
 }
}
