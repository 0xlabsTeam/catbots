import { z } from 'zod';
export const categories = ['trigger', 'data', 'indicator', 'process', 'condition', 'strategy', 'risk', 'action', 'output'] as const;
export type NodeCategory = typeof categories[number];
export type ValueType = 'flow' | 'event' | 'candles' | 'number' | 'condition' | 'order-plan' | 'orders' | 'json';
export type Candle = { closedAt: number; open: number; high: number; low: number; close: number; volume: number };
export type Value = { type: ValueType; value: unknown; quality: 'ready' | 'unavailable'; reason?: string };
export type Fill = { id: string; clientOrderId: string; side: 'buy' | 'sell'; quantity: number; price: number; fee: number };
export type OrderPlan = { clientOrderId: string; side: 'buy' | 'sell'; quantity: number; limitPrice?: number; reduceOnly: boolean; purpose: 'entry' | 'exit' };
export type FlowContext = { runId: string; deploymentId: string; market: string; at: number; price: number; equity: number; candles: Record<string, readonly Candle[]>; fills: readonly Fill[]; cancelledOrderIds: readonly string[] };
export type FlowNode = { id: string; type: string; version: number; config: Record<string, unknown> };
export type FlowEdge = { source: string; sourcePort: string; target: string; targetPort: string };
export type FlowDocument = { schemaVersion: '3.0'; nodes: FlowNode[]; edges: FlowEdge[] };
export type NodeResult = { outputs: Record<string, Value>; state?: unknown; orders?: OrderPlan[]; cancelOrderIds?: string[] };
export type FlowDefinition = {
  type: string; version: number; category: NodeCategory; title: string;
  activation?: string;
  config: z.ZodType; inputs: Record<string, ValueType>; outputs: Record<string, ValueType>;
  evaluate(input: Record<string, Value>, config: any, context: FlowContext, state: unknown, nodeId: string): NodeResult;
};
export type RuntimePackage = { name: string; version: string; definitions: readonly FlowDefinition[] };
export const ready = (type: ValueType, value: unknown): Value => ({ type, value, quality: 'ready' });
export const unavailable = (type: ValueType, reason: string): Value => ({ type, value: null, quality: 'unavailable', reason });
export const numberConfig = z.number().finite();
export const positive = numberConfig.positive();
export const percentage = positive.max(100);
const orderSchema = z.object({ clientOrderId: z.string().min(1), side: z.enum(['buy', 'sell']), quantity: positive, limitPrice: positive.optional(), reduceOnly: z.boolean(), purpose: z.enum(['entry', 'exit']) }).strict();
const candleSchema = z.object({ closedAt: numberConfig, open: positive, high: positive, low: positive, close: positive, volume: numberConfig.nonnegative() }).strict();
function validateValue(value: Value, type: ValueType): boolean {
  if (!value || value.type !== type) return false;
  if (value.quality === 'unavailable') return value.value === null && typeof value.reason === 'string' && value.reason.length > 0;
  if (value.quality !== 'ready') return false;
  switch (type) {
    case 'number': return numberConfig.safeParse(value.value).success;
    case 'flow':
    case 'condition': return typeof value.value === 'boolean';
    case 'candles': return z.array(candleSchema).safeParse(value.value).success;
    case 'orders': return z.array(orderSchema).safeParse(value.value).success;
    case 'order-plan': return orderSchema.safeParse(value.value).success;
    default: return value.value !== undefined;
  }
}
export function definePackage(name: string, definitions: readonly FlowDefinition[]): RuntimePackage { return { name, version: '0.1.0', definitions }; }
export function requireInputs(inputs: Record<string, Value>): string | undefined { return Object.values(inputs).find((value) => value.quality !== 'ready')?.reason; }

export type FlowRun = { runId: string; market: string; at: number; state: Record<string, unknown>; orders: OrderPlan[]; cancelOrderIds: string[]; trace: { nodeId: string; status?: 'executed' | 'skipped' | 'unavailable'; inputs: Record<string, Value>; outputs: Record<string, Value> }[] };
/** A deterministic evaluation. The host must commit state and orders in one transaction before dispatch. */
export function evaluateFlow(document: FlowDocument, packages: readonly RuntimePackage[], context: FlowContext, previous: Record<string, unknown> = {}): FlowRun {
  if (document.schemaVersion !== '3.0' || !context.runId || !context.market || !context.deploymentId || !Number.isFinite(context.at)) throw new Error('Invalid flow context');
  if (document.nodes.length > 200 || document.edges.length > 1000) throw new Error('Flow size limit exceeded');
  const { parsed, queue } = prepareFlow(document, packages);
  const snapshot = structuredClone(context);
  const run: FlowRun = { runId: context.runId, market: context.market, at: context.at, state: structuredClone(previous), orders: [], cancelOrderIds: [], trace: [] };
  const outputs = new Map<string, Record<string, Value>>();
  for (const id of queue) {
    const {definition, config} = parsed.get(id)!;
    const input = Object.fromEntries(document.edges.filter(edge => edge.target === id).map(edge => [edge.targetPort, structuredClone(outputs.get(edge.source)![edge.sourcePort])]));
    const activation = definition.activation ? input[definition.activation] : undefined;
    const status = activation?.quality === 'unavailable' ? 'unavailable' : activation?.value === false ? 'skipped' : 'executed';
    const result: NodeResult = status === 'executed'
      ? definition.evaluate(input, structuredClone(config), structuredClone(snapshot), structuredClone(run.state[id]), id)
      : { outputs: Object.fromEntries(Object.entries(definition.outputs).map(([port, type]) => [port, type === 'flow' && status === 'skipped' ? ready('flow', false) : unavailable(type, activation?.reason ?? 'Flow not activated')])) };
    for (const port of Object.keys(result.outputs)) if (!Object.hasOwn(definition.outputs, port)) throw new Error(`Unknown output ${id}.${port}`);
    for (const [port, type] of Object.entries(definition.outputs)) if (!validateValue(result.outputs[port], type)) throw new Error(`Invalid output ${id}.${port}`);
    if ((result.orders?.length || result.cancelOrderIds?.length) && definition.category !== 'strategy' && definition.category !== 'action') throw new Error('Node has no execution capability');
    z.array(orderSchema).parse(result.orders ?? []);
    z.array(z.string().min(1)).parse(result.cancelOrderIds ?? []);
    if (result.state !== undefined) run.state[id] = structuredClone(result.state);
    outputs.set(id, structuredClone(result.outputs));
    run.orders.push(...(result.orders ?? [])); run.cancelOrderIds.push(...(result.cancelOrderIds ?? []));
    run.trace.push({ nodeId: id, status, inputs: input, outputs: structuredClone(result.outputs) });
  }
  if (new Set(run.orders.map(order => order.clientOrderId)).size !== run.orders.length) throw new Error('Duplicate order ID');
  if (run.orders.some(order => run.cancelOrderIds.includes(order.clientOrderId))) throw new Error('Cannot propose and cancel the same order');
  run.cancelOrderIds = [...new Set(run.cancelOrderIds)];
  return run;
}

export function prepareFlow(document: FlowDocument, packages: readonly RuntimePackage[]) {
  if (document.schemaVersion !== '3.0' || document.nodes.length > 200 || document.edges.length > 1000) throw new Error('Invalid flow document');
  const definitions = new Map<string, FlowDefinition>();
  for (const pkg of packages) for (const definition of pkg.definitions) {
    const key = `${definition.type}@${definition.version}`;
    if (definitions.has(key)) throw new Error(`Duplicate definition ${key}`);
    definitions.set(key, definition);
  }
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  if (nodes.size !== document.nodes.length) throw new Error('Duplicate node ID');
  const parsed = new Map<string, { definition: FlowDefinition; config: unknown }>();
  for (const node of document.nodes) {
    const definition = definitions.get(`${node.type}@${node.version}`);
    if (!definition) throw new Error(`Unknown node ${node.type}@${node.version}`);
    if (definition.activation && definition.inputs[definition.activation] !== 'flow') throw new Error('Activation port must have flow type');
    parsed.set(node.id, { definition, config: definition.config.parse(node.config) });
  }
  const remaining = new Map(document.nodes.map(node => [node.id, 0]));
  const targets = new Set<string>();
  for (const edge of document.edges) {
    const from = parsed.get(edge.source)?.definition.outputs[edge.sourcePort];
    const to = parsed.get(edge.target)?.definition.inputs[edge.targetPort];
    if (!from || !to || from !== to) throw new Error('Incompatible or unknown ports');
    const key = JSON.stringify([edge.target, edge.targetPort]);
    if (targets.has(key)) throw new Error('Input must have exactly one source; use a combiner');
    targets.add(key); remaining.set(edge.target, remaining.get(edge.target)! + 1);
  }
  for (const [id, {definition}] of parsed) for (const port of Object.keys(definition.inputs)) if (!targets.has(JSON.stringify([id,port]))) throw new Error(`Missing input ${id}.${port}`);
  const queue = document.nodes.filter(node => remaining.get(node.id) === 0).map(node => node.id);
  for (let index = 0; index < queue.length; index++) for (const edge of document.edges.filter(edge => edge.source === queue[index])) {
    remaining.set(edge.target, remaining.get(edge.target)! - 1);
    if (remaining.get(edge.target) === 0) queue.push(edge.target);
  }
  if (queue.length !== nodes.size) throw new Error('Cycles are not allowed; state belongs to a strategy node');
  return { parsed, queue };
}
