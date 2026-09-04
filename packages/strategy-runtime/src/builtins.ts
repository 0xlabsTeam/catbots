import { z } from 'zod';

import { NodeRegistry, type NodeDefinition, type PortDefinition } from './node-registry';

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

const operatorLabels: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

export const builtinNodeDefinitions: readonly NodeDefinition[] = [
  definition({
    kind: 'trigger', type: 'trigger.interval', version: 1,
    configSchema: z.object({
      every: z.string().regex(/^[1-9]\d*[mhd]$/, 'Interval must be at least one minute'),
      alignment: z.literal('utc'),
    }).strict(),
    inputs: [], outputs: activationOutput,
    visualization: {
      title: 'Interval', icon: 'clock',
      summary: (config) => {
        const parsed = z.object({ every: z.string() }).passthrough().safeParse(config);
        return parsed.success ? `Every ${parsed.data.every}` : 'Interval';
      },
    },
    requirements: noRequirements(),
  }),
  definition({
    kind: 'trigger', type: 'trigger.event', version: 1,
    configSchema: z.object({
      eventType: z.string().trim().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/),
      filters: z.record(z.string(), z.union([z.boolean(), z.number().finite(), z.string()])).default({}),
    }).strict(),
    inputs: [], outputs: activationOutput,
    visualization: { title: 'Event', icon: 'broadcast', summary: () => 'When event arrives' },
    requirements: noRequirements(),
  }),
  definition({
    kind: 'condition', type: 'predicate.compare', version: 1,
    configSchema: z.object({
      left: operandSchema,
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
      right: operandSchema,
    }).strict(),
    inputs: activationInput, outputs: conditionOutput,
    visualization: {
      title: 'Compare', icon: 'scales',
      summary: (config) => {
        const parsed = z.object({ left: operandSchema, operator: z.string(), right: operandSchema }).safeParse(config);
        return parsed.success
          ? `${operandLabel(parsed.data.left)} ${operatorLabels[parsed.data.operator] ?? parsed.data.operator} ${operandLabel(parsed.data.right)}`
          : 'Compare values';
      },
    },
    requirements: { data: ['dynamic:operand-refs'], entitlements: [], permissions: [] },
  }),
  definition({
    kind: 'condition', type: 'predicate.position_state', version: 1,
    configSchema: z.object({ state: z.enum(['flat', 'open', 'long', 'short']), market: z.string().min(1).optional() }).strict(),
    inputs: activationInput, outputs: conditionOutput,
    visualization: { title: 'Position', icon: 'wallet', summary: () => 'Check position state' },
    requirements: { data: ['account.positions'], entitlements: [], permissions: [] },
  }),
  ...(['all', 'any'] as const).map((combiner) => definition({
    kind: 'condition', type: `combine.${combiner}`, version: 1,
    configSchema: z.object({}).strict(), inputs: conditionInput, outputs: conditionOutput,
    visualization: { title: combiner.toUpperCase(), icon: 'tree', summary: () => combiner.toUpperCase() },
    requirements: noRequirements(),
  })),
  definition({
    kind: 'condition', type: 'combine.not', version: 1,
    configSchema: z.object({}).strict(), inputs: singleConditionInput, outputs: conditionOutput,
    visualization: { title: 'NOT', icon: 'tree', summary: () => 'NOT' },
    requirements: noRequirements(),
  }),
  definition({
    kind: 'condition', type: 'combine.at_least', version: 1,
    configSchema: z.object({ count: z.number().int().positive() }).strict(), inputs: conditionInput, outputs: conditionOutput,
    visualization: { title: 'AT LEAST', icon: 'tree', summary: (config) => `At least ${String((config as { count?: unknown })?.count ?? '?')}` },
    requirements: noRequirements(),
  }),
  definition({
    kind: 'action', type: 'execution.open_position', version: 1,
    configSchema: z.object({
      side: z.enum(['long', 'short']),
      size: z.object({ type: z.enum(['equity_percent', 'quote']), value: z.number().positive() }).strict().optional(),
      leverage: z.number().positive().optional(),
      stopLoss: z.object({ type: z.literal('percent'), value: z.number().positive() }).strict().optional(),
    }).strict(),
    inputs: singleConditionInput, outputs: [],
    visualization: { title: 'Open position', icon: 'trend-up', summary: () => 'Open position' },
    requirements: { data: ['market.price', 'account.equity'], entitlements: [], permissions: ['execution.place_order'] },
  }),
  definition({
    kind: 'action', type: 'execution.close_position', version: 1,
    configSchema: z.object({ side: z.enum(['long', 'short']).optional(), percent: z.number().positive().max(100).default(100) }).strict(),
    inputs: singleConditionInput, outputs: [],
    visualization: { title: 'Close position', icon: 'x-circle', summary: () => 'Close position' },
    requirements: { data: ['account.positions'], entitlements: [], permissions: ['execution.place_order'] },
  }),
  definition({
    kind: 'action', type: 'state.set', version: 1,
    configSchema: z.object({ key: z.string().trim().min(1), value: z.union([z.null(), z.boolean(), z.number().finite(), z.string()]) }).strict(),
    inputs: singleConditionInput, outputs: [],
    visualization: { title: 'Set state', icon: 'database', summary: () => 'Update bot state' },
    requirements: { data: [], entitlements: [], permissions: ['state.write'] },
  }),
];

export function createBuiltinRegistry(): NodeRegistry {
  return new NodeRegistry(builtinNodeDefinitions);
}
