import { z } from 'zod';
export type AdapterDescriptor = { id: string; name: string; environments: ('production'|'testnet')[]; authentication: ('public-address'|'wallet'|'api-key'|'oauth')[]; capabilities: { accountDiscovery: boolean; markets: string[]; trading: boolean } };
export const TradingAccountSchema = z.object({ id:z.string(), name:z.string(), kind:z.enum(['main','subaccount','portfolio']), address:z.string(), equity:z.string(), withdrawable:z.string(), positions:z.number().int().nonnegative(), accountMode:z.string().optional(), usdcBalance:z.string().optional() });
export const ExchangeConnectionSchema = z.object({ id:z.string().uuid(), adapterId:z.string(), name:z.string(), environment:z.enum(['production','testnet']), owner:z.string(), permission:z.enum(['view-only','trading-authorized']), authorizationCheckedAt:z.string().datetime().optional(), accounts:z.array(TradingAccountSchema), updatedAt:z.string().datetime() });
export type ExchangeConnection = z.infer<typeof ExchangeConnectionSchema>;
export type TradingAccount = z.infer<typeof TradingAccountSchema>;
export const ConnectionCommandSchema = z.discriminatedUnion('action',[
 z.object({action:z.literal('list')}).strict(),
 z.object({action:z.literal('open_wallet_browser')}).strict(),
 z.object({action:z.literal('prepare_authorization'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('verify_authorization'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('complete_authorization'),id:z.string().uuid(),signature:z.string().regex(/^0x[a-fA-F0-9]{130}$/)}).strict(),
 z.object({action:z.literal('connect'),adapterId:z.string().min(1).max(64),name:z.string().trim().min(1).max(80),environment:z.enum(['production','testnet']),owner:z.string().trim().min(1).max(200)}).strict(),
 z.object({action:z.literal('refresh'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('remove'),id:z.string().uuid()}).strict(),
]);
export type ConnectionCommand = z.infer<typeof ConnectionCommandSchema>;
export type ConnectionsView = { authorization?: {connectionId:string;owner:string;environment:string;typedData:unknown}; adapters:AdapterDescriptor[]; connections:ExchangeConnection[] };
