import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { evaluateFlow, definePackage, ready, assertItems, readItemField, type FlowDocument, type FlowContext, type ExecutionItem } from '@catbots/node-kit';
import { runtimeNodePackages } from './node-packages';
const context: FlowContext = { runId: 'r1', deploymentId: 'd1', market: 'SOL-PERP', at: 10000, price: 10, equity: 1000, candles: {}, fills: [], cancelledOrderIds: [] };
const node = (id: string, type: string, config = {}): FlowDocument['nodes'][number] => ({ id, type, version: 1, config });
const edge = (source: string, target: string, sourcePort = 'main', targetPort = 'main') => ({ source, target, sourcePort, targetPort });
const source = (records: ExecutionItem[]) => definePackage('fixture', [{ type: 'fixture.items', version: 1, category: 'trigger', config: z.object({}), title: 'Fixture', inputs: {}, outputs: { main: 'items' }, evaluate: () => ({ outputs: { main: ready('items', structuredClone(records)) } }) }]);
function run(records: ExecutionItem[], nodes: FlowDocument['nodes'], edges: FlowDocument['edges']) {
  return evaluateFlow({ schemaVersion: '3.0', nodes: [node('source', 'fixture.items'), ...nodes], edges }, [...runtimeNodePackages, source(records)], context);
}
const items = [{ json: { market: 'SOL-PERP', value: 20 } }, { json: { market: 'SOL-PERP', value: 60 } }];
describe('JSON item execution', () => {
  it('routes original items, preserves lineage and executes only the matching order branch', () => {
    const result = run(items, [node('if', 'condition.if_items', { field: 'value', operator: 'lt', valueJson: '30' }), node('order', 'action.item_order', { side: 'buy', quantityField: 'value' })], [edge('source', 'if'), edge('if', 'order', 'true')]);
    expect(result.orders).toHaveLength(1); expect(result.orders[0].quantity).toBe(20);
    expect(result.trace[1].outputs.false.value).toEqual([{ ...items[1], pairedItem: [{ nodeId: 'source', port: 'main', item: 1 }] }]);
    expect((result.trace[2].outputs.main.value as ExecutionItem[])[0].pairedItem).toEqual([{ nodeId: 'if', port: 'true', item: 0 }]);
    expect(items[0]).not.toHaveProperty('pairedItem');
  });
  it('skips empty branches without proposals, while Merge can append the active branch', () => {
    const result = run(items, [node('if', 'condition.if_items', { field: 'value', operator: 'lt', valueJson: '0' }), node('order', 'action.item_order', { side: 'buy' }), node('merge', 'process.merge', { mode: 'append' })], [edge('source', 'if'), edge('if', 'order', 'true'), edge('if', 'merge', 'true', 'left'), edge('if', 'merge', 'false', 'right')]);
    expect(result.orders).toEqual([]); expect(result.trace.find(t => t.nodeId === 'order')?.status).toBe('skipped');
    expect(result.trace.find(t => t.nodeId === 'merge')?.outputs.main.value).toHaveLength(2);
  });
  it('splits, maps and aggregates items with all input references', () => {
    const result = run([{ json: { market: 'SOL-PERP', values: [0, 2, 4] } }], [node('split', 'process.split_out', { field: 'values' }), node('map', 'process.edit_fields', { field: 'amount', valueMode: 'field', sourceField: 'value' }), node('sum', 'process.aggregate', { field: 'amount', operation: 'sum' })], [edge('source', 'split'), edge('split', 'map'), edge('map', 'sum')]);
    const output = result.trace.at(-1)!.outputs.main.value as ExecutionItem[];
    expect(output[0].json).toEqual({ market: 'SOL-PERP', value: 6 }); expect(output[0].pairedItem).toHaveLength(3);
  });
  it('does not coerce false, null or missing fields', () => {
    expect(readItemField({ flag: false, value: null }, 'flag')).toBe(false);
    expect(readItemField({ value: null }, 'value')).toBeNull();
    expect(() => run(items, [node('if', 'condition.if_items', { field: 'missing', operator: 'eq', valueJson: 'null' })], [edge('source', 'if')])).toThrow('Missing');
    expect(() => run(items, [node('if', 'condition.if_items', { field: 'value', operator: 'gt', valueJson: '"10"' })], [edge('source', 'if')])).toThrow('numbers');
  });
  it('rejects non-JSON payloads, unsafe paths and oversized batches', () => {
    for (const value of [NaN, Infinity, undefined, new Date()]) expect(() => assertItems([{ json: { value } }])).toThrow();
    expect(() => assertItems(Array.from({ length: 10001 }, () => ({ json: {} })))).toThrow();
    expect(() => readItemField({}, '__proto__.polluted')).toThrow();
  });
  it('refuses cross-market orders and ambiguous scalar conversion', () => {
    expect(() => run([{ json: { market: 'ETH-PERP', quantity: 1 } }], [node('order', 'action.item_order', { side: 'buy' })], [edge('source', 'order')])).toThrow('market');
    expect(() => run(items, [node('scalar', 'process.items_to_number')], [edge('source', 'scalar')])).toThrow('exactly one');
  });
  it('rejects duplicate merge keys rather than creating a cartesian product', () => {
    expect(() => run(items, [node('merge', 'process.merge', { mode: 'match', key: 'market' })], [edge('source', 'merge', 'main', 'left'), edge('source', 'merge', 'main', 'right')])).toThrow('Duplicate Merge');
  });
  it('runs native market → candles → indicator → If → order items without scalar wires', () => {
    const document: FlowDocument = { schemaVersion: '3.0', nodes: [node('tick', 'trigger.items'), node('data', 'data.candle_items', { timeframe: '5m' }), node('ema', 'indicator.ema_items', { period: 2 }), node('if', 'condition.if_items', { field: 'ema', operator: 'gt', valueJson: '1' }), node('size', 'process.edit_fields', { field: 'quantity', valueJson: '0.1' }), node('order', 'action.item_order', { side: 'buy' })], edges: [edge('tick', 'data'), edge('data', 'ema'), edge('ema', 'if'), edge('if', 'size', 'true'), edge('size', 'order')] };
    const result = evaluateFlow(document, runtimeNodePackages, { ...context, candles: { '5m': [1,2,3].map((close, index) => ({ closedAt: index + 1, open: close, high: close, low: close, close, volume: 10 })) } });
    expect(result.orders).toHaveLength(1); expect(result.orders[0].quantity).toBe(0.1);
    expect((result.trace[2].outputs.main.value as ExecutionItem[])[0].json.ema).toBe(2.5);
    const unavailable = evaluateFlow(document, runtimeNodePackages, context);
    expect(unavailable.orders).toEqual([]); expect(unavailable.trace.at(-1)?.status).toBe('unavailable');
  });
});
