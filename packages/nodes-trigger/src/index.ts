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

export const triggerDefinitions: readonly NodeDefinition[] = [
] = [
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
      scope: z.enum(['market', 'dex']).default('market'),
    }).strict(),
    inputs: [], outputs: activationOutput,
    visualization: { title: 'Event', icon: 'broadcast', summary: (config) => { const value = config as { eventType: string; scope?: string }; return `On ${value.eventType} · ${value.scope ?? 'market'}`; } },
    requirements: noRequirements(),
  }),

];

import { definePackage, ready } from '@catbots/node-kit';
export const triggerPackage = definePackage('@catbots/nodes-trigger', [{
  type: 'trigger.tick', version: 1, category: 'trigger', title: 'Evaluation tick',
  config: z.object({}).strict(), inputs: {}, outputs: { tick: 'event', flow: 'flow' },
  evaluate: () => ({ outputs: { tick: ready('event', true), flow: ready('flow', true) } }),
}, {
  type: 'trigger.items', version: 1, category: 'trigger', title: 'Market evaluation',
  config: z.object({}).strict(), inputs: {}, outputs: { main: 'items' },
  evaluate: (_input, _config, context) => ({ outputs: { main: ready('items', [{ json: { market: context.market, at: context.at, runId: context.runId } }]) } }),
}]);
