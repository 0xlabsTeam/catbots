import { z } from 'zod';

import type { NodeDefinition, PortDefinition } from '@catbots/node-kit';

const activationInput: readonly PortDefinition[] = [
  { id: 'activation', dataType: 'activation', cardinality: 'one' },
];
const activationOutput: readonly PortDefinition[] = [
  { id: 'activation', dataType: 'activation', cardinality: 'many' },
];
const conditionInput: readonly PortDefinition[] = [
  { id: 'conditions', dataType: 'condition', cardinality: 'many' },
];
const singleConditionInput: readonly PortDefinition[] = [
  { id: 'condition', dataType: 'condition', cardinality: 'one' },
];
const conditionOutput: readonly PortDefinition[] = [
  { id: 'result', dataType: 'condition', cardinality: 'many' },
];

const referenceSchema = z.object({
  ref: z.string().trim().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/),
  field: z.string().trim().min(1).optional(),
  maxAgeSeconds: z.number().int().nonnegative().optional(),
}).strict();

const literalSchema = z.object({
  literal: z.union([z.null(), z.boolean(), z.number().finite(), z.string()]),
}).strict();

const operandSchema = z.union([referenceSchema, literalSchema]);

function noRequirements() {
  return { data: [], entitlements: [], permissions: [] } as const;
}

function definition(value: NodeDefinition): NodeDefinition {
  return value;
}

function operandLabel(input: unknown): string {
  const result = operandSchema.safeParse(input);
  if (!result.success) return '?';
  if ('literal' in result.data) return String(result.data.literal);
  return result.data.field ? `${result.data.ref}.${result.data.field}` : result.data.ref;
}

function positionSummary(config: unknown): string {
  const value = config as { state: string; market?: string };
  const labels: Record<string, string> = { flat: 'No open position', open: 'Has an open position', long: 'Has a long position', short: 'Has a short position' };
  return `${labels[value.state] ?? value.state} · ${value.market ?? 'current market'}`;
}

const operatorLabels: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

export const actionDefinitions: readonly NodeDefinition[] = [
  definition({
    kind: 'action', type: 'execution.open_position', version: 1,
    configSchema: z.object({
      side: z.enum(['long', 'short']),
      size: z.object({ type: z.enum(['equity_percent', 'quote']), value: z.number().positive() }).strict().optional(),
      leverage: z.number().positive().optional(),
      stopLoss: z.object({ type: z.literal('percent'), value: z.number().positive() }).strict().optional(),
    }).strict(),
    inputs: singleConditionInput, outputs: [],
    visualization: { title: 'Open position', icon: 'trend-up', summary: (config) => { const value = config as { side: string; size?: { type: string; value: number }; leverage?: number; stopLoss?: { value: number } }; return [`Open ${value.side}`, value.size ? `${value.size.value}${value.size.type === 'equity_percent' ? '% equity' : ' quote'}` : 'Default size', value.leverage ? `${value.leverage}×` : null, value.stopLoss ? `SL ${value.stopLoss.value}%` : null].filter(Boolean).join(' · '); } },
    requirements: { data: ['market.price', 'account.equity'], entitlements: [], permissions: ['execution.place_order'] },
  }),
  definition({
    kind: 'action', type: 'execution.close_position', version: 1,
    configSchema: z.object({ side: z.enum(['long', 'short']).optional(), percent: z.number().positive().max(100).default(100) }).strict(),
    inputs: singleConditionInput, outputs: [],
    visualization: { title: 'Close position', icon: 'x-circle', summary: (config) => { const value = config as { side?: string; percent?: number }; return `Close ${value.percent ?? 100}% · ${value.side ?? 'current position'}`; } },
    requirements: { data: ['account.positions'], entitlements: [], permissions: ['execution.place_order'] },
  }),
  definition({
    kind: 'action', type: 'state.set', version: 1,
    configSchema: z.object({ key: z.string().trim().min(1), value: z.union([z.null(), z.boolean(), z.number().finite(), z.string()]) }).strict(),
    inputs: singleConditionInput, outputs: [],
    visualization: { title: 'Set state', icon: 'database', summary: (config) => { const value = config as { key: string; value: unknown }; return `${value.key} = ${String(value.value)}`; } },
    requirements: { data: [], entitlements: [], permissions: ['state.write'] },
  }),
];

import { definePackage, ready, type OrderPlan } from '@catbots/node-kit';
export const actionPackage = definePackage('@catbots/nodes-action', [{
  type:'action.order',version:1,category:'action',title:'Propose order',
  config:z.object({side:z.enum(['buy','sell']),reduceOnly:z.boolean().default(false)}).strict(),inputs:{signal:'condition',quantity:'number'},outputs:{orders:'orders'},
  evaluate(input,config,context,_state,nodeId){
    const quantity=input.quantity.value as number;
    const orders:OrderPlan[]=input.signal.quality==='ready'&&input.signal.value===true&&input.quantity.quality==='ready'&&Number.isFinite(quantity)&&quantity>0?[{clientOrderId:JSON.stringify([context.deploymentId,context.market,nodeId,context.runId]),side:config.side,quantity,reduceOnly:config.reduceOnly,purpose:config.reduceOnly?'exit':'entry'}]:[];
    return {orders,outputs:{orders:ready('orders',orders)}};
  },
}]);
