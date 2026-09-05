import { expect, it } from 'vitest';
import { z } from 'zod';
import { definePackage, evaluateFlow, ready, type FlowContext, type FlowDefinition, type NodeResult } from './flow';
const context: FlowContext = { runId: '1', deploymentId: 'test', market: 'TEST', at: 1, price: 100, equity: 1000, candles: {}, fills: [], cancelledOrderIds: [] };
function evaluate(result: NodeResult, category: FlowDefinition['category'] = 'process') {
  const definition: FlowDefinition = { type: 'test', version: 1, category, title: 'Test', config: z.object({}), inputs: {}, outputs: { value: 'number' }, evaluate: () => result };
  return evaluateFlow({ schemaVersion: '3.0', nodes: [{ id: 'node', type: 'test', version: 1, config: {} }], edges: [] }, [definePackage('test', [definition])], context);
}
it('rejects invalid values behind correctly named output types', () => {
  for (const value of [NaN, Infinity, '12', null]) expect(() => evaluate({ outputs: { value: ready('number', value) } })).toThrow('Invalid output');
  expect(() => evaluate({ outputs: { value: ready('number', 1), extra: ready('number', 2) } })).toThrow('Unknown output');
});
it('prevents non-execution nodes from cancelling orders', () => {
  expect(() => evaluate({ outputs: { value: ready('number', 1) }, cancelOrderIds: ['order'] })).toThrow('execution capability');
});
it('validates proposals before returning a run', () => {
  const order = { clientOrderId: 'o', side: 'buy' as const, quantity: 1, reduceOnly: false, purpose: 'entry' as const };
  expect(() => evaluate({ outputs: { value: ready('number', 1) }, orders: [{ ...order, quantity: -1 }] }, 'action')).toThrow();
  expect(() => evaluate({ outputs: { value: ready('number', 1) }, orders: [order, order] }, 'action')).toThrow('Duplicate order');
  expect(() => evaluate({ outputs: { value: ready('number', 1) }, orders: [order], cancelOrderIds: ['o'] }, 'action')).toThrow('same order');
});
