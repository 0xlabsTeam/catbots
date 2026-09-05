import type { NodePackage } from './node-packages';
export const exampleNodePackage: NodePackage = {
  format: 'catbots-subflow', sdkVersion: 1, name: '@catbots/funding-filter', version: '1.0.0', license: 'MIT',
  nodes: [{ type: 'catbots.funding_filter', version: 1, kind: 'condition', title: 'Funding filter',
    description: 'Match markets whose funding rate is below the configured threshold. Uses the host market funding snapshot.',
    fields: { threshold: { type: 'number', label: 'Funding threshold', default: 0, minimum: -1, maximum: 1 } },
    nodes: [{ id: 'compare', kind: 'condition', type: 'predicate.compare', version: 1,
      config: { left: { ref: 'market.funding', field: 'rate' }, operator: 'lt', right: { literal: { $param: 'threshold' } } } }],
    edges: [], inputs: [{ id: 'activation', dataType: 'activation', targets: [{ node: 'compare', port: 'activation' }] }],
    outputs: [{ id: 'result', dataType: 'condition', source: { node: 'compare', port: 'result' } }],
  }],
};
