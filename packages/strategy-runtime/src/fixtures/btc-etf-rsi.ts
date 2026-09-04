import { parseStrategyDocument } from '../strategy-schema';

export const btcEtfRsiStrategy = parseStrategyDocument({
  schemaVersion: '1.0',
  strategy: { id: 'btc-etf-rsi', name: 'BTC ETF Flow and RSI', version: 1 },
  nodes: [
    { id: 't-15m', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
    { id: 'c-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi.14', field: 'value', maxAgeSeconds: 60 }, operator: 'lt', right: { literal: 30 } } },
    { id: 'c-funding', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.funding', field: 'rate' }, operator: 'lt', right: { literal: 0 } } },
    { id: 'c-flat', kind: 'condition', type: 'predicate.position_state', version: 1, config: { state: 'flat', market: 'BTC-PERP' } },
    { id: 'c-momentum', kind: 'condition', type: 'combine.any', version: 1, config: {} },
    { id: 'c-entry', kind: 'condition', type: 'combine.all', version: 1, config: {} },
    { id: 'a-open', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 1_000 }, leverage: 2 } },
    { id: 't-etf', kind: 'trigger', type: 'trigger.event', version: 1, config: { eventType: 'data.etf_flow.updated', filters: { asset: 'BTC' } } },
    { id: 'c-etf-negative', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'data.etf_flow.btc.net_daily', field: 'usd' }, operator: 'lt', right: { literal: 0 } } },
    { id: 'a-close', kind: 'action', type: 'execution.close_position', version: 1, config: { percent: 100 } },
  ],
  edges: [
    { id: 'e1', source: 't-15m', sourcePort: 'activation', target: 'c-rsi', targetPort: 'activation' },
    { id: 'e2', source: 't-15m', sourcePort: 'activation', target: 'c-funding', targetPort: 'activation' },
    { id: 'e3', source: 't-15m', sourcePort: 'activation', target: 'c-flat', targetPort: 'activation' },
    { id: 'e4', source: 'c-rsi', sourcePort: 'result', target: 'c-momentum', targetPort: 'conditions' },
    { id: 'e5', source: 'c-funding', sourcePort: 'result', target: 'c-momentum', targetPort: 'conditions' },
    { id: 'e6', source: 'c-momentum', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e7', source: 'c-flat', sourcePort: 'result', target: 'c-entry', targetPort: 'conditions' },
    { id: 'e8', source: 'c-entry', sourcePort: 'result', target: 'a-open', targetPort: 'condition' },
    { id: 'e9', source: 't-etf', sourcePort: 'activation', target: 'c-etf-negative', targetPort: 'activation' },
    { id: 'e10', source: 'c-etf-negative', sourcePort: 'result', target: 'a-close', targetPort: 'condition' },
  ],
});
