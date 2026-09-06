import { expect, it } from 'vitest';
import { evaluatePackagedFlow } from './node-packages';
import { exampleContext } from './package-examples';
import type { FlowDocument } from '@catbots/node-kit';
function program(threshold: number): FlowDocument {
  return { schemaVersion: '3.0', nodes: [
    { id: 'tick', type: 'trigger.tick', version: 1, config: {} },
    { id: 'a', type: 'process.number', version: 1, config: { value: 10 } },
    { id: 'b', type: 'process.number', version: 1, config: { value: threshold } },
    { id: 'condition', type: 'condition.compare', version: 1, config: { operator: 'lt' } },
    { id: 'branch', type: 'condition.branch', version: 1, config: {} },
    ...['yes', 'no'].map(id => ({ id, type: 'action.flow_order', version: 1, config: { side: 'buy' } })),
  ], edges: [
    { source: 'a', sourcePort: 'value', target: 'condition', targetPort: 'left' },
    { source: 'b', sourcePort: 'value', target: 'condition', targetPort: 'right' },
    { source: 'tick', sourcePort: 'flow', target: 'branch', targetPort: 'flow' },
    { source: 'condition', sourcePort: 'result', target: 'branch', targetPort: 'condition' },
    ...['yes', 'no'].flatMap((target, index) => [
      { source: 'branch', sourcePort: index === 0 ? 'true' : 'false', target, targetPort: 'flow' },
      { source: 'a', sourcePort: 'value', target, targetPort: 'quantity' },
    ]),
  ] };
}
it.each([[30, 'yes', 'no'], [5, 'no', 'yes']] as const)('activates exactly one branch at threshold %s', (threshold, active, skipped) => {
  const result = evaluatePackagedFlow(program(threshold), exampleContext('branch-test', 0, 100));
  expect(result.orders).toHaveLength(1);
  expect(result.trace.find(node => node.nodeId === active)?.status).toBe('executed');
  expect(result.trace.find(node => node.nodeId === skipped)?.status).toBe('skipped');
  expect(result.trace.find(node => node.nodeId === skipped)?.outputs.orders.quality).toBe('unavailable');
});
it('does not treat unavailable data as a false branch', () => {
  const doc = program(30);
  doc.nodes[1] = { id: 'a', type: 'data.price', version: 1, config: {} };
  const result = evaluatePackagedFlow(doc, { ...exampleContext('unavailable', 0, 100), price: NaN });
  expect(result.orders).toEqual([]);
  expect(result.trace.filter(node => ['yes', 'no'].includes(node.nodeId)).map(node => node.status)).toEqual(['unavailable', 'unavailable']);
});
