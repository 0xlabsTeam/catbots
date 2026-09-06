import type { FlowDocument } from '@catbots/node-kit';
import { createPackageExample } from './package-examples';

/** Teaching example: two independent order-proposal branches, never a deployment template. */
export function createAllCategoryExample(): FlowDocument {
  const graph = createPackageExample('dca');
  graph.nodes.push(
    { id: 'price', type: 'data.price', version: 1, config: {} },
    { id: 'equity', type: 'data.equity', version: 1, config: {} },
    { id: 'stop', type: 'process.number', version: 1, config: { value: 98 } },
    { id: 'size', type: 'risk.position_size', version: 1, config: { riskPercent: 1, maxNotional: 100 } },
    { id: 'order', type: 'action.order', version: 1, config: { side: 'buy', reduceOnly: false } },
  );
  graph.edges.push(
    { source: 'price', sourcePort: 'value', target: 'size', targetPort: 'entry' },
    { source: 'equity', sourcePort: 'value', target: 'size', targetPort: 'equity' },
    { source: 'stop', sourcePort: 'value', target: 'size', targetPort: 'stop' },
    { source: 'size', sourcePort: 'quantity', target: 'order', targetPort: 'quantity' },
    { source: 'entry', sourcePort: 'result', target: 'order', targetPort: 'signal' },
  );
  return graph;
}
