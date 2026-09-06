import { z } from 'zod';
import { ready, readItemField, assertJson, type ExecutionItem, type FlowDefinition } from '@catbots/node-kit';
const path = z.string().min(1).max(200).refine(value => value.split('.').every(key => key && !['__proto__', 'constructor', 'prototype'].includes(key)), 'Use a safe dotted field path');
const items = (input: Parameters<FlowDefinition['evaluate']>[0]) => input.main.value as ExecutionItem[];
export const ifItemsDefinition: FlowDefinition = { type: 'condition.if_items', version: 1, category: 'condition', title: 'If', inputs: { main: 'items' }, outputs: { true: 'items', false: 'items' },
    config: z.object({ field: path, operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']), valueJson: z.string().default('0') }).strict(),
    evaluate(input, config) {
      const expected: unknown = JSON.parse(config.valueJson); assertJson(expected);
      const yes: ExecutionItem[] = [], no: ExecutionItem[] = [];
      for (const item of items(input)) {
        const value = readItemField(item.json, config.field);
        let pass: boolean;
        if (config.operator === 'eq' || config.operator === 'neq') { pass = JSON.stringify(value) === JSON.stringify(expected); if (config.operator === 'neq') pass = !pass; }
        else { if (typeof value !== 'number' || typeof expected !== 'number') throw new Error('Ordered comparisons require numbers'); pass = config.operator === 'lt' ? value < expected : config.operator === 'lte' ? value <= expected : config.operator === 'gt' ? value > expected : value >= expected; }
        (pass ? yes : no).push(item);
      }
      return { outputs: { true: ready('items', yes), false: ready('items', no) } };
    } };
