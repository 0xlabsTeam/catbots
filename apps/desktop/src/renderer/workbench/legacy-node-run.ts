import type { MarketSnapshot, StrategyRevision } from '@catbots/contracts';
import { createEvaluationContext, evaluateConditionNode, matchesIntervalTrigger, matchesEventTrigger, type IntervalTriggerConfig, type EventTriggerConfig, type StrategyNode } from '@catbots/strategy-runtime/node-inspection';
export type LegacyStep = { nodeId: string; status: 'executed' | 'skipped' | 'unavailable'; inputs: unknown; outputs: unknown; condition?: ReturnType<typeof evaluateConditionNode>; active: boolean };
export function runLegacyNode(revision: StrategyRevision, nodeId: string, market: string, eventType = '', payload: Record<string, unknown> = {}, snapshot?: MarketSnapshot, mode: 'manual' | 'schedule' = 'manual') {
  const at = snapshot?.fetchedAt ?? '2026-01-01T00:00:00.000Z';
  const context = createEvaluationContext({ currentMarket: market, evaluatedAt: at, values: snapshot ? Object.fromEntries(Object.entries({ 'market.price': { mark: snapshot.price }, 'market.funding': { rate: snapshot.funding } }).map(([key, value]) => [key, { value, provider: snapshot.source, observedAt: at, freshnessSeconds: 60, quality: { status: 'verified' as const }, integrityHash: 'manual-market-snapshot' }])) : {} });
  const results = new Map<string, LegacyStep>();
  const visiting = new Set<string>();
  function evaluate(id: string): LegacyStep {
    if (results.has(id)) return results.get(id)!;
    if (visiting.has(id)) throw new Error('Cycle in graph');
    const node = revision.nodes.find(node => node.id === id);
    if (!node?.config) throw new Error('Reload to load node configuration');
    visiting.add(id);
    const upstream = revision.edges.filter(edge => edge.target === id).map(edge => evaluate(edge.source));
    let step: LegacyStep;
    if (node.kind === 'trigger') {
      if (node.type === 'trigger.interval') {
        const scheduled = matchesIntervalTrigger(node.config as IntervalTriggerConfig, at);
        const active = mode === 'manual' || scheduled;
        step = { nodeId: id, status: active ? 'executed' : 'skipped', inputs: { occurredAt: at, activationSource: mode === 'manual' ? 'manual-run' : 'schedule', scheduleMatched: scheduled }, outputs: { activation: active }, active };
      } else if (node.type === 'trigger.event' && eventType) {
        const event = { id: 'manual-test-event', type: eventType, market, occurredAt: at, receivedAt: at, source: 'manual-test', payload: payload as Record<string, never>, quality: { status: 'verified' as const, freshnessSeconds: 0 } };
        const active = matchesEventTrigger(node.config as EventTriggerConfig, event);
        step = { nodeId: id, status: active ? 'executed' : 'skipped', inputs: event, outputs: { activation: active }, active };
      } else step = { nodeId: id, status: 'unavailable', inputs: {}, outputs: { reason: 'Supply a test event type and payload for an Event trigger.' }, active: false };
    } else if (node.kind === 'condition') {
      const condition = evaluateConditionNode({ ...node, config: node.config } as StrategyNode, context, upstream.flatMap(item => item.condition ? [item.condition] : []));
      const active = upstream.some(item => item.active) || upstream.length === 0;
      step = { nodeId: id, status: !active ? 'skipped' : condition.value === 'unknown' ? 'unavailable' : 'executed', inputs: { connections: upstream.map(item => ({ nodeId: item.nodeId, outputs: item.outputs })), references: condition.inputs }, outputs: { result: active ? condition.value : 'unknown', reason: active ? condition.reason : 'Trigger did not activate' }, condition: active ? condition : { value: 'unknown', reason: 'data.missing', inputs: [] }, active };
    } else {
      const controller = upstream.find(item => item.condition);
      const active = controller?.active === true && controller.condition?.value === true;
      step = { nodeId: id, status: active ? 'executed' : controller?.condition?.value === 'unknown' ? 'unavailable' : 'skipped',
        inputs: upstream.map(item => ({ nodeId: item.nodeId, outputs: item.outputs })),
        outputs: active ? { proposal: { type: node.type, market, config: node.config }, dispatched: false } : { proposal: null, reason: 'Controlling condition is not true', dispatched: false }, active };
    }
    visiting.delete(id); results.set(id, step); return step;
  }
  const selected = evaluate(nodeId);
  return { selected, trace: [...results.values()], at, market };
}
