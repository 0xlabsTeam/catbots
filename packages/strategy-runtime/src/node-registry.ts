import type { z } from 'zod';

import type { StrategyNode } from './strategy-schema';

export type NodeKind = StrategyNode['kind'];
export type PortDataType = 'activation' | 'condition';

export type PortDefinition = Readonly<{
  id: string;
  dataType: PortDataType;
  cardinality: 'one' | 'many';
}>;

export type NodeRequirements = Readonly<{
  data: readonly string[];
  entitlements: readonly string[];
  permissions: readonly string[];
}>;

export type NodeDefinition = Readonly<{
  kind: NodeKind;
  type: string;
  version: number;
  configSchema: z.ZodType;
  inputs: readonly PortDefinition[];
  outputs: readonly PortDefinition[];
  visualization: Readonly<{
    title: string;
    icon: string;
    summary: (config: unknown) => string;
  }>;
  requirements: NodeRequirements;
}>;

export type NodeConfigIssue = Readonly<{
  nodeId: string;
  path: PropertyKey[];
  message: string;
}>;

export type NodeConfigValidation =
  | Readonly<{ success: true; config: unknown }>
  | Readonly<{ success: false; issues: NodeConfigIssue[] }>;

function registryKey(kind: NodeKind, type: string, version: number): string {
  return `${kind}/${type}@${version}`;
}

function freezeDefinition(definition: NodeDefinition): NodeDefinition {
  const inputs = Object.freeze(definition.inputs.map((port) => Object.freeze({ ...port })));
  const outputs = Object.freeze(definition.outputs.map((port) => Object.freeze({ ...port })));
  const requirements = Object.freeze({
    data: Object.freeze([...definition.requirements.data]),
    entitlements: Object.freeze([...definition.requirements.entitlements]),
    permissions: Object.freeze([...definition.requirements.permissions]),
  });

  return Object.freeze({
    ...definition,
    inputs,
    outputs,
    visualization: Object.freeze({ ...definition.visualization }),
    requirements,
  });
}

export class NodeRegistry {
  readonly #definitions: ReadonlyMap<string, NodeDefinition>;
  readonly #list: readonly NodeDefinition[];

  constructor(definitions: readonly NodeDefinition[]) {
    const entries = new Map<string, NodeDefinition>();
    for (const candidate of definitions) {
      const key = registryKey(candidate.kind, candidate.type, candidate.version);
      if (entries.has(key)) {
        throw new Error(`Duplicate node definition: ${key}`);
      }
      entries.set(key, freezeDefinition(candidate));
    }
    this.#definitions = entries;
    this.#list = Object.freeze([...entries.values()]);
  }

  get(kind: NodeKind, type: string, version: number): NodeDefinition {
    const key = registryKey(kind, type, version);
    const definition = this.#definitions.get(key);
    if (!definition) {
      throw new Error(`Unknown node definition: ${key}`);
    }
    return definition;
  }

  find(kind: NodeKind, type: string, version: number): NodeDefinition | undefined {
    return this.#definitions.get(registryKey(kind, type, version));
  }

  list(): readonly NodeDefinition[] {
    return this.#list;
  }

  validateConfig(node: StrategyNode): NodeConfigValidation {
    const definition = this.find(node.kind, node.type, node.version);
    if (!definition) {
      return {
        success: false,
        issues: [{ nodeId: node.id, path: [], message: `Unknown node definition: ${registryKey(node.kind, node.type, node.version)}` }],
      };
    }

    const result = definition.configSchema.safeParse(node.config);
    if (result.success) {
      return { success: true, config: result.data };
    }
    return {
      success: false,
      issues: result.error.issues.map((issue) => ({
        nodeId: node.id,
        path: [...issue.path],
        message: issue.message,
      })),
    };
  }
}
