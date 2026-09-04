import type { NodeDefinition, NodeRegistry, PortDefinition } from './node-registry';
import type { StrategyDocument, StrategyEdge, StrategyNode } from './strategy-schema';

export type ValidationError = Readonly<{
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}>;

export type CompiledStrategy = Readonly<{
  document: StrategyDocument;
  triggerIds: readonly string[];
  topologicalNodeIds: readonly string[];
  incomingEdges: ReadonlyMap<string, readonly StrategyEdge[]>;
  outgoingEdges: ReadonlyMap<string, readonly StrategyEdge[]>;
  triggerOwners: ReadonlyMap<string, readonly string[]>;
}>;

export type ValidationResult =
  | Readonly<{ valid: true; compiled: CompiledStrategy }>
  | Readonly<{ valid: false; errors: readonly ValidationError[] }>;

function findPort(ports: readonly PortDefinition[], id: string): PortDefinition | undefined {
  return ports.find((port) => port.id === id);
}

function isPredicate(node: StrategyNode): boolean {
  return node.kind === 'condition' && node.type.startsWith('predicate.');
}

function isCombiner(node: StrategyNode): boolean {
  return node.kind === 'condition' && node.type.startsWith('combine.');
}

function isAllowedTransition(source: StrategyNode, target: StrategyNode): boolean {
  return (source.kind === 'trigger' && isPredicate(target))
    || (source.kind === 'condition' && isCombiner(target))
    || (source.kind === 'condition' && target.kind === 'action');
}

function pushMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function topologicalOrder(
  document: StrategyDocument,
  outgoing: ReadonlyMap<string, readonly StrategyEdge[]>,
): readonly string[] {
  const position = new Map(document.nodes.map((node, index) => [node.id, index]));
  const inDegree = new Map(document.nodes.map((node) => [node.id, 0]));
  for (const edge of document.edges) {
    if (inDegree.has(edge.target) && inDegree.has(edge.source)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const ready = document.nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id);
  const ordered: string[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0));
    const nodeId = ready.shift();
    if (!nodeId) break;
    ordered.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const remaining = (inDegree.get(edge.target) ?? 0) - 1;
      inDegree.set(edge.target, remaining);
      if (remaining === 0) ready.push(edge.target);
    }
  }
  return ordered;
}

function findTriggerOwners(
  document: StrategyDocument,
  outgoing: ReadonlyMap<string, readonly StrategyEdge[]>,
): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, Set<string>>(
    document.nodes.map((node) => [node.id, new Set<string>()]),
  );

  for (const trigger of document.nodes.filter((node) => node.kind === 'trigger')) {
    const pending = [trigger.id];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.shift();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      owners.get(nodeId)?.add(trigger.id);
      for (const edge of outgoing.get(nodeId) ?? []) pending.push(edge.target);
    }
  }

  return new Map(
    document.nodes.map((node) => [node.id, Object.freeze([...owners.get(node.id) ?? []])]),
  );
}

export function validateStrategy(document: StrategyDocument, registry: NodeRegistry): ValidationResult {
  const errors: ValidationError[] = [];
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const definitions = new Map<string, NodeDefinition>();
  const incoming = new Map<string, StrategyEdge[]>();
  const outgoing = new Map<string, StrategyEdge[]>();

  for (const node of document.nodes) {
    const definition = registry.find(node.kind, node.type, node.version);
    if (!definition) {
      errors.push({
        code: 'node.unknown_definition',
        message: `Unknown node definition: ${node.kind}/${node.type}@${node.version}`,
        nodeId: node.id,
      });
      continue;
    }
    definitions.set(node.id, definition);
    const config = registry.validateConfig(node);
    if (!config.success) {
      for (const issue of config.issues) {
        errors.push({ code: 'node.invalid_config', message: issue.message, nodeId: node.id });
      }
    }
  }

  const logicalEdges = new Set<string>();
  for (const edge of document.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      errors.push({ code: 'edge.unknown_node', message: 'Edge references an unknown node', edgeId: edge.id });
      continue;
    }

    pushMapValue(outgoing, source.id, edge);
    pushMapValue(incoming, target.id, edge);

    const logicalKey = `${edge.source}\0${edge.sourcePort}\0${edge.target}\0${edge.targetPort}`;
    if (logicalEdges.has(logicalKey)) {
      errors.push({ code: 'edge.duplicate', message: 'Duplicate logical edge', edgeId: edge.id });
    }
    logicalEdges.add(logicalKey);

    const sourcePort = findPort(definitions.get(source.id)?.outputs ?? [], edge.sourcePort);
    const targetPort = findPort(definitions.get(target.id)?.inputs ?? [], edge.targetPort);
    if (!sourcePort) {
      errors.push({ code: 'edge.unknown_source_port', message: `Unknown source port: ${edge.sourcePort}`, edgeId: edge.id });
    }
    if (!targetPort) {
      errors.push({ code: 'edge.unknown_target_port', message: `Unknown target port: ${edge.targetPort}`, edgeId: edge.id });
    }
    if (sourcePort && targetPort && sourcePort.dataType !== targetPort.dataType) {
      errors.push({ code: 'edge.incompatible_ports', message: 'Source and target port types are incompatible', edgeId: edge.id });
    }
    if (!isAllowedTransition(source, target)) {
      errors.push({ code: 'edge.forbidden_transition', message: `Forbidden ${source.kind}-to-${target.kind} transition`, edgeId: edge.id });
    }
  }

  for (const node of document.nodes) {
    const definition = definitions.get(node.id);
    if (!definition) continue;
    for (const port of definition.inputs) {
      const count = (incoming.get(node.id) ?? []).filter((edge) => edge.targetPort === port.id).length;
      if (count === 0) {
        errors.push({
          code: node.kind === 'action' ? 'action.missing_condition' : 'port.missing_edge',
          message: `Required input port has no edge: ${port.id}`,
          nodeId: node.id,
        });
      } else if (port.cardinality === 'one' && count > 1) {
        errors.push({ code: 'port.too_many_edges', message: `Input port accepts one edge: ${port.id}`, nodeId: node.id });
      }
    }
  }

  const order = topologicalOrder(document, outgoing);
  if (order.length !== document.nodes.length) {
    errors.push({ code: 'graph.cycle', message: 'Strategy graph contains a cycle' });
  }

  const triggerOwners = findTriggerOwners(document, outgoing);
  for (const node of document.nodes) {
    if (node.kind === 'trigger') continue;
    const ownerCount = triggerOwners.get(node.id)?.length ?? 0;
    if (ownerCount === 0) {
      errors.push({ code: 'node.unreachable', message: 'Node is not reachable from a Trigger', nodeId: node.id });
    } else if (ownerCount > 1) {
      errors.push({ code: 'node.multiple_triggers', message: 'Node is reachable from more than one Trigger', nodeId: node.id });
    }
  }

  if (errors.length > 0) {
    const nodePosition = new Map(document.nodes.map((node, index) => [node.id, index]));
    const edgePosition = new Map(document.edges.map((edge, index) => [edge.id, index]));
    errors.sort((left, right) => {
      const leftPosition = left.nodeId !== undefined
        ? nodePosition.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER
        : edgePosition.get(left.edgeId ?? '') ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = right.nodeId !== undefined
        ? nodePosition.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER
        : edgePosition.get(right.edgeId ?? '') ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition || left.code.localeCompare(right.code);
    });
    return { valid: false, errors: Object.freeze(errors) };
  }

  return {
    valid: true,
    compiled: Object.freeze({
      document,
      triggerIds: Object.freeze(document.nodes.filter((node) => node.kind === 'trigger').map((node) => node.id)),
      topologicalNodeIds: Object.freeze([...order]),
      incomingEdges: incoming,
      outgoingEdges: outgoing,
      triggerOwners,
    }),
  };
}
