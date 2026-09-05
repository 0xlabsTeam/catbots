import { describe, expect, it } from 'vitest';
import { exampleNodePackage } from '@catbots/contracts';
import { CommunityNodeCatalog, validateNodePackage } from './community-nodes';
import { createBuiltinRegistry } from './builtins';
import { validateStrategy } from './graph-validator';
const entry = { manifest: exampleNodePackage, integrity: `sha256:${'a'.repeat(64)}`, enabled: true };
const strategy = { schemaVersion: '2.0', strategy: { id: 'test', name: 'Test', version: 1 }, marketScope: { type: 'dex_universe' }, nodes: [
  { id: 'clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
  { id: 'funding', kind: 'condition', type: 'catbots.funding_filter', version: 1, config: { threshold: -0.01 } },
  { id: 'save', kind: 'action', type: 'state.set', version: 1, config: { key: 'match', value: true } },
], edges: [{ id: 'one', source: 'clock', sourcePort: 'activation', target: 'funding', targetPort: 'activation' }, { id: 'two', source: 'funding', sourcePort: 'result', target: 'save', targetPort: 'condition' }] };
describe('community subflows', () => {
  it('expands an installed node into a valid built-in graph with pinned provenance', () => {
    const catalog = new CommunityNodeCatalog([entry]);
    expect(catalog.registry.get('condition', 'catbots.funding_filter', 1).visualization.title).toBe('Funding filter');
    const document = catalog.compile(strategy);
    expect(validateStrategy(document, createBuiltinRegistry()).valid).toBe(true);
    expect(document.nodes[1]).toMatchObject({ id: 'funding__compare', type: 'predicate.compare', config: { right: { literal: -0.01 } } });
    expect(document.packageLock).toEqual([{ name: exampleNodePackage.name, version: '1.0.0', integrity: entry.integrity }]);
    // Historical compiled graphs need no dynamic package code, even after disabling the package.
    expect(validateStrategy(new CommunityNodeCatalog([]).compile(document), createBuiltinRegistry()).valid).toBe(true);
  });
  it('rejects missing packages at validation rather than silently substituting another node', () => {
    expect(validateStrategy(new CommunityNodeCatalog([]).compile(strategy), createBuiltinRegistry()).valid).toBe(false);
  });
  it('rejects invalid parameter values and nonexistent exposed ports', () => {
    const invalid = structuredClone(strategy); invalid.nodes[1]!.config = { threshold: 50 } as never;
    expect(() => new CommunityNodeCatalog([entry]).compile(invalid)).toThrow();
    const badPort = structuredClone(strategy); badPort.edges[0]!.targetPort = 'missing';
    expect(() => new CommunityNodeCatalog([entry]).compile(badPort)).toThrow();
  });
  it('rejects runtime scripts, nested packages, type collisions and invalid internal graphs', () => {
    expect(() => validateNodePackage({ ...exampleNodePackage, script: 'process.exit()' })).toThrow();
    const nested = structuredClone(exampleNodePackage); nested.nodes[0]!.nodes[0]!.type = 'catbots.funding_filter';
    expect(() => validateNodePackage(nested)).toThrow();
    expect(() => new CommunityNodeCatalog([entry, entry])).toThrow();
    const bad = structuredClone(exampleNodePackage); bad.nodes[0]!.inputs[0]!.targets[0]!.port = 'missing';
    expect(() => validateNodePackage(bad)).toThrow();
  });
});
