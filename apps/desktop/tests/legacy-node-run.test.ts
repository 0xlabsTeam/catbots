import { expect, it } from 'vitest';
import type { StrategyRevision } from '@catbots/contracts';
import { runLegacyNode } from '../src/renderer/workbench/legacy-node-run';
const revision = {
  nodes: [
    { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
    { id: 'check', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'ETH-PERP' } } },
    { id: 'buy', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 100 } } },
  ],
  edges: [{ source: 'clock', target: 'check' }, { source: 'check', target: 'buy' }],
} as unknown as StrategyRevision;
it('runs a trigger without running downstream actions', () => {
  const result = runLegacyNode(revision, 'clock', 'ETH-PERP');
  expect(result.trace).toHaveLength(1);
  expect(result.selected.outputs).toEqual({ activation: true });
});
it('runs action ancestors, proposes only on true, and never dispatches', () => {
  const result = runLegacyNode(revision, 'buy', 'ETH-PERP');
  expect(result.trace.map(item => item.nodeId)).toEqual(['clock', 'check', 'buy']);
  expect(result.selected.outputs).toMatchObject({ dispatched: false, proposal: { type: 'execution.open_position' } });
  expect(runLegacyNode(revision, 'buy', 'BTC-PERP').selected.status).toBe('skipped');
});
it('does not manufacture an event to satisfy an event trigger', () => {
  const eventRevision = structuredClone(revision);
  eventRevision.nodes[0] = { ...eventRevision.nodes[0]!, type: 'trigger.event', config: { eventType: 'signal', filters: { side: 'long' } } };
  expect(runLegacyNode(eventRevision, 'buy', 'ETH-PERP').selected.status).toBe('unavailable');
  expect(runLegacyNode(eventRevision, 'buy', 'ETH-PERP', 'signal', { side: 'long' }).selected.status).toBe('executed');
});
