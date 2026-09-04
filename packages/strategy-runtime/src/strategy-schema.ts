import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const StableIdSchema = z.string().trim().min(1).max(120);

export const StrategyNodeSchema = z.object({
  id: StableIdSchema,
  kind: z.enum(['trigger', 'condition', 'action']),
  type: z.string().trim().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/),
  version: z.number().int().positive(),
  config: z.record(z.string(), JsonValueSchema),
}).strict();

export const StrategyEdgeSchema = z.object({
  id: StableIdSchema,
  source: StableIdSchema,
  sourcePort: StableIdSchema,
  target: StableIdSchema,
  targetPort: StableIdSchema,
}).strict();

export const StrategyDocumentSchema = z.object({
  schemaVersion: z.literal('1.0'),
  strategy: z.object({
    id: StableIdSchema,
    name: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
  }).strict(),
  nodes: z.array(StrategyNodeSchema).min(1),
  edges: z.array(StrategyEdgeSchema),
}).strict().superRefine((document, context) => {
  const nodeIds = new Set<string>();
  for (const [index, node] of document.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate node ID: ${node.id}`,
        path: ['nodes', index, 'id'],
      });
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const [index, edge] of document.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate edge ID: ${edge.id}`,
        path: ['edges', index, 'id'],
      });
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.source)) {
      context.addIssue({
        code: 'custom',
        message: `Unknown source node: ${edge.source}`,
        path: ['edges', index, 'source'],
      });
    }
    if (!nodeIds.has(edge.target)) {
      context.addIssue({
        code: 'custom',
        message: `Unknown target node: ${edge.target}`,
        path: ['edges', index, 'target'],
      });
    }
  }
});

export type StrategyNode = z.infer<typeof StrategyNodeSchema>;
export type StrategyEdge = z.infer<typeof StrategyEdgeSchema>;
export type StrategyDocument = z.infer<typeof StrategyDocumentSchema>;

export function parseStrategyDocument(input: unknown): StrategyDocument {
  return StrategyDocumentSchema.parse(input);
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

export function serializeStrategyDocument(document: StrategyDocument): string {
  return JSON.stringify(sortJson(document));
}
