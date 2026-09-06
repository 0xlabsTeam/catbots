import { z } from 'zod';
import { ready, readItemField, assertJson, type ExecutionItem, type FlowDefinition, type Json, unavailable } from '@catbots/node-kit';
const path = z.string().min(1).max(200).refine(value => value.split('.').every(key => key && !['__proto__', 'constructor', 'prototype'].includes(key)), 'Use a safe dotted field path');
const items = (input: Parameters<FlowDefinition['evaluate']>[0], port = 'main') => input[port].value as ExecutionItem[];
const result = (value: ExecutionItem[]) => ({ outputs: { main: ready('items', value) } });
export const itemDefinitions: FlowDefinition[] = [
  { type: 'process.edit_fields', version: 1, category: 'process', title: 'Edit Fields', inputs: { main: 'items' }, outputs: { main: 'items' },
    config: z.object({ field: path, valueJson: z.string().default('null'), valueMode: z.enum(['literal', 'field']).default('literal'), sourceField: path.default('value'), keepOtherFields: z.boolean().default(true) }).strict(),
    evaluate(input, config) {
      const literal: unknown = config.valueMode === 'literal' ? JSON.parse(config.valueJson) : null; assertJson(literal);
      return result(items(input).map(item => {
        const json: Record<string, Json> = config.keepOtherFields ? structuredClone(item.json) : {};
        const keys = config.field.split('.'); let target = json;
        for (const key of keys.slice(0, -1)) {
          if (target[key] === undefined) target[key] = {};
          if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) throw new Error(`Cannot write through field ${key}`);
          target = target[key] as Record<string, Json>;
        }
        target[keys.at(-1)!] = structuredClone(config.valueMode === 'field' ? readItemField(item.json, config.sourceField) : literal);
        return { json, pairedItem: item.pairedItem };
      }));
    } },
  { type: 'process.split_out', version: 1, category: 'process', title: 'Split Out', inputs: { main: 'items' }, outputs: { main: 'items' },
    config: z.object({ field: path, outputField: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).default('value') }).strict(),
    evaluate(input, config) { return result(items(input).flatMap(item => {
      const array = readItemField(item.json, config.field); if (!Array.isArray(array)) throw new Error('Split Out requires an array field');
      return array.map(value => ({ json: { ...item.json, [config.outputField]: value }, pairedItem: item.pairedItem }));
    })); } },
  { type: 'process.aggregate', version: 1, category: 'process', title: 'Aggregate', inputs: { main: 'items' }, outputs: { main: 'items' },
    config: z.object({ field: path.default('value'), operation: z.enum(['sum', 'average', 'count', 'collect']).default('collect') }).strict(),
    evaluate(input, config, context) {
      const records = items(input);
      if (records.some(item => item.json.market !== context.market)) throw new Error('Aggregate requires items from the execution market');
      const values = records.map(item => readItemField(item.json, config.field));
      if (['sum', 'average'].includes(config.operation) && values.some(value => typeof value !== 'number')) throw new Error('Aggregate requires numeric fields');
      const sum = ['sum', 'average'].includes(config.operation) ? (values as number[]).reduce((total, value) => total + value, 0) : 0;
      const value = config.operation === 'collect' ? values : config.operation === 'count' ? records.length : config.operation === 'sum' ? sum : sum / records.length;
      return result([{ json: { market: context.market, value }, pairedItem: records.flatMap(item => item.pairedItem ?? []) }]);
    } },
  { type: 'process.merge', version: 1, category: 'process', title: 'Merge', acceptsEmptyItems: true, inputs: { left: 'items', right: 'items' }, outputs: { main: 'items' },
    config: z.object({ mode: z.enum(['append', 'match']).default('append'), key: path.default('market') }).strict(),
    evaluate(input, config) {
      const left = items(input, 'left'), right = items(input, 'right');
      if (config.mode === 'append') return result([...left, ...right]);
      const seen = new Set<string>();
      const keyOf = (item: ExecutionItem) => { const key = readItemField(item.json, config.key); if (key === null || typeof key === 'object') throw new Error('Merge key must be a non-null scalar'); return JSON.stringify(key); };
      const indexed = new Map(right.map(item => { const key = keyOf(item); if (seen.has(key)) throw new Error('Duplicate Merge key'); seen.add(key); return [key, item]; }));
      seen.clear();
      return result(left.flatMap(item => {
        const key = keyOf(item); if (seen.has(key)) throw new Error('Duplicate Merge key'); seen.add(key);
        const other = indexed.get(key); if (!other) return [];
        if (item.json.market !== undefined && other.json.market !== undefined && item.json.market !== other.json.market) throw new Error('Cannot merge different markets');
        for (const field of Object.keys(other.json)) if (Object.hasOwn(item.json, field) && JSON.stringify(item.json[field]) !== JSON.stringify(other.json[field])) throw new Error(`Conflicting Merge field: ${field}`);
        return [{ json: { ...item.json, ...other.json }, pairedItem: [...item.pairedItem ?? [], ...other.pairedItem ?? []] }];
      }));
    } },
  ...(['number', 'candles', 'condition', 'orders'] as const).map(type => ({
    type: `process.${type}_to_items`, version: 1, category: 'process' as const, title: `${type} to Items`, inputs: { value: type }, outputs: { main: 'items' as const },
    config: z.object({ field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).default('value') }).strict(),
    evaluate(input, config, context) { return input.value.quality === 'ready' ? result([{ json: { market: context.market, [config.field]: input.value.value as Json } }]) : { outputs: { main: unavailable('items', input.value.reason ?? 'Source unavailable') } }; },
  } satisfies FlowDefinition)),
  ...(['number', 'candles', 'condition', 'orders'] as const).map(type => ({
    type: `process.items_to_${type}`, version: 1, category: 'process' as const, title: `Items to ${type}`, inputs: { main: 'items' as const }, outputs: { value: type },
    config: z.object({ field: path.default('value') }).strict(),
    evaluate(input, config, context) {
      const records = items(input); if (records.length !== 1) throw new Error('Trading adapter requires exactly one item; filter or aggregate first');
      if (records[0].json.market !== context.market) throw new Error('Item market must match the execution market');
      return { outputs: { value: ready(type, readItemField(records[0].json, config.field)) } };
    },
  } satisfies FlowDefinition)),
];
