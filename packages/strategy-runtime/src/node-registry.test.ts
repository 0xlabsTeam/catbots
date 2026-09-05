import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBuiltinRegistry } from './builtins';
import { NodeRegistry } from './node-registry';

describe('NodeRegistry', () => {
  it('looks up an implementation by exact kind, type, and version', () => {
    const definition = createBuiltinRegistry().get('trigger', 'trigger.interval', 1);

    expect(definition.visualization.title).toBe('Interval');
    expect(definition.outputs).toEqual([{ id: 'activation', dataType: 'activation', cardinality: 'many' }]);
  });

  it('rejects duplicate registration keys', () => {
    const definition = {
      kind: 'trigger' as const,
      type: 'trigger.test',
      version: 1,
      configSchema: z.object({}).strict(),
      inputs: [],
      outputs: [{ id: 'activation', dataType: 'activation' as const, cardinality: 'many' as const }],
      visualization: { title: 'Test', icon: 'clock', summary: () => 'Test' },
      requirements: { data: [], entitlements: [], permissions: [] },
    };

    expect(() => new NodeRegistry([definition, definition])).toThrow(/duplicate node definition/i);
  });

  it('refuses unknown versions instead of falling back', () => {
    expect(() => createBuiltinRegistry().get('trigger', 'trigger.interval', 2)).toThrow(
      /unknown node definition: trigger\/trigger\.interval@2/i,
    );
  });

  it('validates node config with the registered strict schema', () => {
    const registry = createBuiltinRegistry();

    expect(registry.validateConfig({
      id: 'trigger-1',
      kind: 'trigger',
      type: 'trigger.interval',
      version: 1,
      config: { every: '30s', alignment: 'utc' },
    })).toEqual({
      success: false,
      issues: [expect.objectContaining({ nodeId: 'trigger-1', path: ['every'] })],
    });
  });

  it('does not expose mutable registry storage', () => {
    const registry = createBuiltinRegistry();
    const listed = registry.list();

    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(() => (listed as unknown[]).pop()).toThrow();
    expect(registry.list()).toHaveLength(12);
  });
});

describe('built-in node definitions', () => {
  it('publishes strict schemas, typed ports, visualization, and requirements', () => {
    const registry = createBuiltinRegistry();
    const compare = registry.get('condition', 'predicate.compare', 1);

    expect(compare.inputs).toEqual([{ id: 'activation', dataType: 'activation', cardinality: 'one' }]);
    expect(compare.outputs).toEqual([{ id: 'result', dataType: 'condition', cardinality: 'many' }]);
    expect(compare.visualization.summary({
      left: { ref: 'indicator.rsi.14', field: 'value' },
      operator: 'lt',
      right: { literal: 30 },
    })).toBe('indicator.rsi.14.value < 30');
    expect(compare.requirements.data).toEqual(['dynamic:operand-refs']);
  });

  it('defaults Event triggers to market scope and permits explicit DEX scope', () => {
    const registry = createBuiltinRegistry();
    const baseNode = {
      id: 'event-1', kind: 'trigger' as const, type: 'trigger.event', version: 1,
      config: { eventType: 'data.etf_flow.updated', filters: {} },
    };

    expect(registry.validateConfig(baseNode)).toMatchObject({
      success: true,
      config: { scope: 'market' },
    });
    expect(registry.validateConfig({
      ...baseNode,
      config: { ...baseNode.config, scope: 'dex' },
    })).toMatchObject({ success: true, config: { scope: 'dex' } });
  });
});
