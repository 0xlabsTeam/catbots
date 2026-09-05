import { z } from 'zod';
import { NodePackageSchema, type NodePackage, type CommunityNode, type InstalledNodePackage } from '@catbots/contracts';
import { createBuiltinRegistry, builtinNodeDefinitions } from './builtins';
import { NodeRegistry, type NodeDefinition } from './node-registry';
import { StrategyV2DocumentSchema, type StrategyNode, type StrategyEdge } from './strategy-schema';
const builtins = createBuiltinRegistry();
export function communityConfigSchema(node: CommunityNode) {
  return z.object(Object.fromEntries(Object.entries(node.fields).map(([key, field]) => {
    let schema: z.ZodType;
    if (field.type === 'number') { let number = z.number().finite(); if (field.minimum !== undefined) number = number.min(field.minimum); if (field.maximum !== undefined) number = number.max(field.maximum); schema = number.prefault(field.default); }
    else schema = field.type === 'boolean' ? z.boolean().prefault(field.default) : z.string().max(500).prefault(field.default);
    return [key, schema];
  }))).strict();
}
function substitute(value: unknown, parameters: Record<string, unknown>, depth = 0): unknown {
  if (depth > 20) throw new Error('Package configuration is too deeply nested');
  if (Array.isArray(value)) return value.map((item) => substitute(item, parameters, depth + 1));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('$param' in object) { if (Object.keys(object).length !== 1 || typeof object.$param !== 'string' || !Object.hasOwn(parameters, object.$param)) throw new Error('Unknown package parameter'); return parameters[object.$param]; }
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, substitute(item, parameters, depth + 1)]));
  }
  return value;
}
export function validateNodePackage(input: unknown): NodePackage {
  const manifest = NodePackageSchema.parse(input);
  const exported = new Set<string>();
  for (const node of manifest.nodes) {
    const key = `${node.kind}/${node.type}@${node.version}`;
    if (exported.has(key) || builtins.find(node.kind, node.type, node.version)) throw new Error('Duplicate node type');
    exported.add(key);
    const scope = manifest.name.split('/')[0]!.slice(1).replaceAll('-', '_');
    if (!node.type.startsWith(`${scope}.`)) throw new Error('Node type must start with the publisher namespace');
    const config = communityConfigSchema(node).parse({});
    const ids = new Set(node.nodes.map((item) => item.id));
    if (ids.size !== node.nodes.length) throw new Error('Duplicate internal node id');
    for (const item of node.nodes) {
      if (item.kind !== node.kind) throw new Error('Subflow internals must match the exported node kind');
      if (!builtins.validateConfig({ ...item, config: substitute(item.config, config) as StrategyNode['config'] }).success) throw new Error('Invalid built-in node or configuration');
    }
    const port = (nodeId: string, portId: string, direction: 'inputs' | 'outputs') => {
      const item = node.nodes.find((item) => item.id === nodeId); if (!item) throw new Error('Missing internal node');
      const result = builtins.get(item.kind, item.type, item.version)[direction].find((item) => item.id === portId);
      if (!result) throw new Error('Missing internal port'); return result;
    };
    for (const edge of node.edges) if (port(edge.source, edge.sourcePort, 'outputs').dataType !== port(edge.target, edge.targetPort, 'inputs').dataType) throw new Error('Incompatible internal ports');
    for (const input of node.inputs) for (const target of input.targets) if (port(target.node, target.port, 'inputs').dataType !== input.dataType) throw new Error('Incompatible exposed input');
    for (const output of node.outputs) if (port(output.source.node, output.source.port, 'outputs').dataType !== output.dataType) throw new Error('Incompatible exposed output');
    for (const list of [node.inputs, node.outputs, node.edges]) if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error('Duplicate port or edge id');
    const remaining = new Set(ids);
    while (remaining.size) { const roots = [...remaining].filter((id) => !node.edges.some((edge) => edge.target === id && remaining.has(edge.source))); if (!roots.length) throw new Error('Cyclic subflow'); roots.forEach((id) => remaining.delete(id)); }
  }
  return manifest;
}
export class CommunityNodeCatalog {
  readonly registry: NodeRegistry;
  private entries: { node: CommunityNode; item: InstalledNodePackage }[];
  constructor(packages: readonly InstalledNodePackage[]) {
    this.entries = packages.filter((item) => item.enabled).flatMap((item) => validateNodePackage(item.manifest).nodes.map((node) => ({ node, item })));
    const definitions: NodeDefinition[] = this.entries.map(({ node }) => ({ kind: node.kind, type: node.type, version: node.version, configSchema: communityConfigSchema(node),
      inputs: node.inputs.map(({ id, dataType }) => ({ id, dataType, cardinality: 'one' })), outputs: node.outputs.map(({ id, dataType }) => ({ id, dataType, cardinality: 'many' })),
      visualization: { title: node.title, icon: 'package', summary: () => node.description }, requirements: { data: [...new Set(node.nodes.flatMap((item) => builtins.get(item.kind, item.type, item.version).requirements.data))], entitlements: [...new Set(node.nodes.flatMap((item) => builtins.get(item.kind, item.type, item.version).requirements.entitlements))], permissions: [...new Set(node.nodes.flatMap((item) => builtins.get(item.kind, item.type, item.version).requirements.permissions))] } }));
    this.registry = new NodeRegistry([...builtinNodeDefinitions, ...definitions]);
  }
  compile(input: unknown) {
    const source = StrategyV2DocumentSchema.parse(input);
    if (source.nodes.length > 200 || source.edges.length > 1000) throw new Error('Strategy exceeds expansion limits');
    const nodes: StrategyNode[] = []; const edges: StrategyEdge[] = [];
    const instances = new Map<string, { node: CommunityNode; prefix: string }>();
    const used = new Map<string, { name: string; version: string; integrity: string }>();
    for (const instance of source.nodes) {
      const entry = this.entries.find(({ node }) => node.kind === instance.kind && node.type === instance.type && node.version === instance.version);
      if (!entry) { nodes.push(instance); continue; }
      const config = communityConfigSchema(entry.node).parse(instance.config);
      const prefix = `${instance.id}__`;
      instances.set(instance.id, { node: entry.node, prefix });
      nodes.push(...entry.node.nodes.map((node) => ({ ...node, id: `${prefix}${node.id}`, config: substitute(node.config, config) as StrategyNode['config'] })));
      edges.push(...entry.node.edges.map((edge) => ({ ...edge, id: `${prefix}${edge.id}`, source: `${prefix}${edge.source}`, target: `${prefix}${edge.target}` })));
      used.set(entry.item.integrity, { name: entry.item.manifest.name, version: entry.item.manifest.version, integrity: entry.item.integrity });
    }
    for (const edge of source.edges) {
      const from = instances.get(edge.source); const to = instances.get(edge.target);
      const output = from?.node.outputs.find((port) => port.id === edge.sourcePort);
      const input = to?.node.inputs.find((port) => port.id === edge.targetPort);
      if ((from && !output) || (to && !input)) throw new Error('Unknown subflow port');
      const targets = input ? input.targets.map((target) => ({ node: to!.prefix + target.node, port: target.port })) : [{ node: edge.target, port: edge.targetPort }];
      for (const [index, target] of targets.entries()) edges.push({ ...edge, id: input ? `${edge.id}__${index}` : edge.id, source: output ? from!.prefix + output.source.node : edge.source, sourcePort: output?.source.port ?? edge.sourcePort, target: target.node, targetPort: target.port });
    }
    if (nodes.length > 1000 || edges.length > 3000) throw new Error('Expanded strategy too large');
    return StrategyV2DocumentSchema.parse({ ...source, nodes, edges, ...(used.size ? { packageLock: [...(source.packageLock ?? []), ...used.values()] } : {}) });
  }
}
