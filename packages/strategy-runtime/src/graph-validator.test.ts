import { describe, expect, it } from 'vitest';

import { createBuiltinRegistry } from './builtins';
import { validateStrategy } from './graph-validator';
import { parseStrategyDocument, type StrategyDocument } from './strategy-schema';

const registry = createBuiltinRegistry();

function validNestedStrategy(): StrategyDocument {
  return parseStrategyDocument({
    schemaVersion: '1.0',
    strategy: { id: 'nested', name: 'Nested conditions', version: 1 },
    nodes: [
      { id: 't-interval', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
      { id: 'c-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi', field: 'value' }, operator: 'lt', right: { literal: 30 } } },
      { id: 'c-funding', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.funding', field: 'rate' }, operator: 'lt', right: { literal: 0 } } },
      { id: 'c-position', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat' } },
      { id: 'c-any', kind: 'condition', type: 'combine.any', version: 1, config: {} },
      { id: 'c-all', kind: 'condition', type: 'combine.all', version: 1, config: {} },
      { id: 'a-open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long' } },
    ],
    edges: [
      { id: 'e1', source: 't-interval', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
      { id: 'e2', source: 't-interval', sourcePort: 'activation', target: 'c-funding', targetPort: 'activation' },
      { id: 'e3', source: 't-interval', sourcePort: 'activation', target: 'c-position', targetPort: 'activation' },
      { id: 'e4', source: 'c-rsi', sourcePort: 'result', target: 'c-any', targetPort: 'conditions' },
      { id: 'e5', source: 'c-funding', sourcePort: 'result', target: 'c-any', targetPort: 'conditions' },
      { id: 'e6', source: 'c-any', sourcePort: 'result', target: 'c-all', targetPort: 'conditions' },
      { id: 'e7', source: 'c-position', sourcePort: 'result', target: 'c-all', targetPort: 'conditions' },
      { id: 'e8', source: 'c-all', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
    ],
  });
}

function cloneStrategy(strategy = validNestedStrategy()): StrategyDocument {
  return structuredClone(strategy);
}

function errorCodes(strategy: StrategyDocument): string[] {
  const result = validateStrategy(strategy, registry);
  return result.valid ? [] : result.errors.map((error) => error.code);
}

describe('validateStrategy', () => {
  it('compiles a nested Trigger-Condition-Action graph in deterministic order', () => {
    const result = validateStrategy(validNestedStrategy(), registry);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.compiled.triggerIds).toEqual(['t-interval']);
      expect(result.compiled.topologicalNodeIds).toEqual([
        't-interval', 'c-rsi', 'c-funding', 'c-position', 'c-any', 'c-all', 'a-open',
      ]);
      expect(result.compiled.triggerOwners.get('a-open')).toEqual(['t-interval']);
    }
  });

  it('accepts multiple independent TCA flows', () => {
    const strategy = cloneStrategy();
    strategy.nodes.push(
      { id: 't-event', kind: 'trigger', type: 'trigger.event', version: 1, config: { eventType: 'data.etf_flow.updated', filters: { asset: 'BTC' } } },
      { id: 'c-etf', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'data.etf_flow', field: 'usd' }, operator: 'gt', right: { literal: 0 } } },
      { id: 'a-state', kind: 'action', type: 'state.set', version: 1, config: { key: 'etf_positive', value: true } },
    );
    strategy.edges.push(
      { id: 'e9', source: 't-event', sourcePort: 'activation', target: 'c-etf', targetPort: 'activation' },
      { id: 'e10', source: 'c-etf', sourcePort: 'result', target: 'a-state', targetPort: 'condition' },
    );

    expect(validateStrategy(strategy, registry).valid).toBe(true);
  });

  it('rejects a cycle in combined conditions', () => {
    const strategy = cloneStrategy();
    strategy.edges.push({ id: 'cycle', source: 'c-all', sourcePort: 'result', target: 'c-any', targetPort: 'conditions' });

    expect(errorCodes(strategy)).toContain('graph.cycle');
  });

  it('rejects duplicate logical edges', () => {
    const strategy = cloneStrategy();
    strategy.edges.push({ ...strategy.edges[0], id: 'duplicate-logical-edge' });

    expect(errorCodes(strategy)).toContain('edge.duplicate');
  });

  it('rejects unknown ports and incompatible port data types', () => {
    const unknownPort = cloneStrategy();
    unknownPort.edges[0] = { ...unknownPort.edges[0], sourcePort: 'missing' };
    const incompatible = cloneStrategy();
    incompatible.edges[0] = { ...incompatible.edges[0], target: 'c-any', targetPort: 'conditions' };

    expect(errorCodes(unknownPort)).toContain('edge.unknown_source_port');
    expect(errorCodes(incompatible)).toContain('edge.incompatible_ports');
  });

  it('rejects invalid node config and unknown node versions', () => {
    const invalidConfig = cloneStrategy();
    invalidConfig.nodes[0] = { ...invalidConfig.nodes[0], config: { every: '30s', alignment: 'utc' } };
    const unknownVersion = cloneStrategy();
    unknownVersion.nodes[0] = { ...unknownVersion.nodes[0], version: 2 };

    expect(errorCodes(invalidConfig)).toContain('node.invalid_config');
    expect(errorCodes(unknownVersion)).toContain('node.unknown_definition');
  });

  it('rejects direct Trigger-to-Action and outgoing Action transitions', () => {
    const triggerToAction = cloneStrategy();
    triggerToAction.edges[0] = { id: 'bad', source: 't-interval', sourcePort: 'activation', target: 'a-open', targetPort: 'condition' };
    const actionOutgoing = cloneStrategy();
    actionOutgoing.edges.push({ id: 'bad', source: 'a-open', sourcePort: 'result', target: 'c-all', targetPort: 'conditions' });

    expect(errorCodes(triggerToAction)).toContain('edge.forbidden_transition');
    expect(errorCodes(actionOutgoing)).toContain('edge.unknown_source_port');
  });

  it('rejects unreachable nodes and Actions without one controlling Condition', () => {
    const unreachable = cloneStrategy();
    unreachable.edges = unreachable.edges.filter((edge) => edge.target !== 'c-position');
    const noController = cloneStrategy();
    noController.edges = noController.edges.filter((edge) => edge.target !== 'a-open');

    expect(errorCodes(unreachable)).toContain('node.unreachable');
    expect(errorCodes(noController)).toContain('action.missing_condition');
  });

  it('rejects a node reached from more than one Trigger', () => {
    const strategy = cloneStrategy();
    strategy.nodes.push({ id: 't-second', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } });
    strategy.edges.push({ id: 'shared', source: 't-second', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' });

    expect(errorCodes(strategy)).toContain('node.multiple_triggers');
  });

  it('rejects excess edges into single-cardinality ports', () => {
    const strategy = cloneStrategy();
    strategy.nodes.push({ id: 'c-second-root', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat' } });
    strategy.edges.push(
      { id: 'activate-second', source: 't-interval', sourcePort: 'activation', target: 'c-second-root', targetPort: 'activation' },
      { id: 'second-controller', source: 'c-second-root', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
    );

    expect(errorCodes(strategy)).toContain('port.too_many_edges');
  });
});
