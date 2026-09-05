import { describe, expect, it } from 'vitest';

import {
  parseStrategyDocument,
  serializeStrategyDocument,
} from './strategy-schema';

const validStrategy = {
  schemaVersion: '1.0',
  strategy: {
    id: 'btc-rsi',
    name: 'BTC RSI',
    version: 1,
  },
  nodes: [
    {
      id: 'trigger-1',
      kind: 'trigger',
      type: 'trigger.interval',
      version: 1,
      config: { alignment: 'utc', every: '15m' },
    },
    {
      id: 'condition-1',
      kind: 'condition',
      type: 'predicate.compare',
      version: 1,
      config: { operator: 'lt' },
    },
    {
      id: 'action-1',
      kind: 'action',
      type: 'execution.open_position',
      version: 1,
      config: { side: 'long' },
    },
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'trigger-1',
      sourcePort: 'activation',
      target: 'condition-1',
      targetPort: 'activation',
    },
    {
      id: 'edge-2',
      source: 'condition-1',
      sourcePort: 'result',
      target: 'action-1',
      targetPort: 'condition',
    },
  ],
};

describe('parseStrategyDocument', () => {
  it('accepts a strict canonical TCA document', () => {
    const parsed = parseStrategyDocument(validStrategy);

    expect(parsed.strategy).toEqual({ id: 'btc-rsi', name: 'BTC RSI', version: 1 });
    expect(parsed.nodes.map((node) => node.kind)).toEqual(['trigger', 'condition', 'action']);
  });

  it('rejects unknown envelope keys instead of silently discarding them', () => {
    expect(() => parseStrategyDocument({ ...validStrategy, executableCode: 'buy()' })).toThrow();
  });

  it('rejects duplicate stable node identifiers', () => {
    expect(() => parseStrategyDocument({
      ...validStrategy,
      nodes: [...validStrategy.nodes, { ...validStrategy.nodes[0] }],
    })).toThrow(/duplicate node id: trigger-1/i);
  });

  it('rejects edges that reference a missing node', () => {
    expect(() => parseStrategyDocument({
      ...validStrategy,
      edges: [{ ...validStrategy.edges[0], target: 'missing-condition' }],
    })).toThrow(/unknown target node: missing-condition/i);
  });

  it('accepts Strategy 2.0 only with the exact dynamic DEX market scope', () => {
    expect(parseStrategyDocument({
      ...validStrategy,
      schemaVersion: '2.0',
      marketScope: { type: 'dex_universe' },
    })).toMatchObject({
      schemaVersion: '2.0',
      marketScope: { type: 'dex_universe' },
    });

    expect(() => parseStrategyDocument({
      ...validStrategy,
      schemaVersion: '2.0',
    })).toThrow();
    expect(() => parseStrategyDocument({
      ...validStrategy,
      schemaVersion: '2.0',
      marketScope: { type: 'fixed' },
    })).toThrow();
  });

  it('keeps Strategy 1.0 strict and free of dynamic market scope', () => {
    expect(() => parseStrategyDocument({
      ...validStrategy,
      marketScope: { type: 'dex_universe' },
    })).toThrow();
  });
});

describe('serializeStrategyDocument', () => {
  it('sorts object keys recursively while preserving graph array order', () => {
    const parsed = parseStrategyDocument(validStrategy);

    expect(serializeStrategyDocument(parsed)).toBe(
      '{"edges":[{"id":"edge-1","source":"trigger-1","sourcePort":"activation","target":"condition-1","targetPort":"activation"},{"id":"edge-2","source":"condition-1","sourcePort":"result","target":"action-1","targetPort":"condition"}],"nodes":[{"config":{"alignment":"utc","every":"15m"},"id":"trigger-1","kind":"trigger","type":"trigger.interval","version":1},{"config":{"operator":"lt"},"id":"condition-1","kind":"condition","type":"predicate.compare","version":1},{"config":{"side":"long"},"id":"action-1","kind":"action","type":"execution.open_position","version":1}],"schemaVersion":"1.0","strategy":{"id":"btc-rsi","name":"BTC RSI","version":1}}',
    );
  });
});
