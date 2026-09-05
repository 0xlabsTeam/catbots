import type { EvaluationContext, EvaluationValue } from './evaluation-context';
import type { JsonValue, StrategyNode } from './strategy-schema';

export type TruthValue = true | false | 'unknown';
export type ConditionReason =
  | 'predicate.matched'
  | 'predicate.not_matched'
  | 'predicate.type_mismatch'
  | 'data.missing'
  | 'data.stale'
  | 'data.unauthorized'
  | 'data.invalid'
  | 'data.field_missing'
  | 'combine.all_true'
  | 'combine.child_false'
  | 'combine.all_false'
  | 'combine.child_true'
  | 'combine.not_true'
  | 'combine.not_false'
  | 'combine.threshold_met'
  | 'combine.threshold_unreachable'
  | 'combine.indeterminate'
  | 'condition.invalid_config';

export type ReferencedInput = Readonly<{
  ref: string;
  field?: string;
  value?: JsonValue;
  provider?: string;
  observedAt?: string;
  freshnessSeconds?: number;
  quality?: string;
  integrityHash?: string;
}>;

export type ConditionResult = Readonly<{
  value: TruthValue;
  reason: ConditionReason;
  inputs: readonly ReferencedInput[];
}>;

type Operand =
  | Readonly<{ literal: JsonValue }>
  | Readonly<{ ref: string; field?: string; maxAgeSeconds?: number }>;

type ResolvedOperand =
  | Readonly<{ known: true; value: JsonValue; input?: ReferencedInput }>
  | Readonly<{ known: false; reason: ConditionReason; input: ReferencedInput }>;

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function referencedInput(ref: string, field: string | undefined, source: EvaluationValue): ReferencedInput {
  return {
    ref,
    ...(field === undefined ? {} : { field }),
    value: source.value,
    provider: source.provider,
    observedAt: source.observedAt,
    freshnessSeconds: source.freshnessSeconds,
    quality: source.quality.status,
    integrityHash: source.integrityHash,
  };
}

function resolveOperand(operand: Operand, context: EvaluationContext): ResolvedOperand {
  if ('literal' in operand) return { known: true, value: operand.literal };

  const source = context.values[operand.ref];
  if (!source) {
    return { known: false, reason: 'data.missing', input: { ref: operand.ref, ...(operand.field ? { field: operand.field } : {}) } };
  }

  const input = referencedInput(operand.ref, operand.field, source);
  if (source.quality.status === 'unauthorized') return { known: false, reason: 'data.unauthorized', input };
  if (source.quality.status === 'invalid') return { known: false, reason: 'data.invalid', input };
  if (source.quality.status === 'stale'
    || (operand.maxAgeSeconds !== undefined && source.freshnessSeconds > operand.maxAgeSeconds)) {
    return { known: false, reason: 'data.stale', input };
  }

  if (operand.field === undefined) return { known: true, value: source.value, input };
  if (!isRecord(source.value) || !(operand.field in source.value)) {
    return { known: false, reason: 'data.field_missing', input };
  }
  return {
    known: true,
    value: source.value[operand.field] ?? null,
    input: { ...input, value: source.value[operand.field] ?? null },
  };
}

function compare(operator: string, left: JsonValue, right: JsonValue): boolean | undefined {
  if (operator === 'eq') return left === right;
  if (operator === 'neq') return left !== right;
  if (typeof left === 'number' && typeof right === 'number') {
    if (operator === 'gt') return left > right;
    if (operator === 'gte') return left >= right;
    if (operator === 'lt') return left < right;
    if (operator === 'lte') return left <= right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    if (operator === 'gt') return left > right;
    if (operator === 'gte') return left >= right;
    if (operator === 'lt') return left < right;
    if (operator === 'lte') return left <= right;
  }
  return undefined;
}

function invalidCondition(): ConditionResult {
  return { value: 'unknown', reason: 'condition.invalid_config', inputs: [] };
}

export function combineConditionResults(
  type: string,
  children: readonly ConditionResult[],
  config: Readonly<Record<string, JsonValue>>,
): ConditionResult {
  const inputs = children.flatMap((child) => child.inputs);
  if (type === 'combine.all') {
    if (children.some((child) => child.value === false)) return { value: false, reason: 'combine.child_false', inputs };
    if (children.some((child) => child.value === 'unknown')) return { value: 'unknown', reason: 'combine.indeterminate', inputs };
    return { value: true, reason: 'combine.all_true', inputs };
  }
  if (type === 'combine.any') {
    if (children.some((child) => child.value === true)) return { value: true, reason: 'combine.child_true', inputs };
    if (children.some((child) => child.value === 'unknown')) return { value: 'unknown', reason: 'combine.indeterminate', inputs };
    return { value: false, reason: 'combine.all_false', inputs };
  }
  if (type === 'combine.not' && children.length === 1) {
    if (children[0]?.value === 'unknown') return { value: 'unknown', reason: 'combine.indeterminate', inputs };
    return children[0]?.value === true
      ? { value: false, reason: 'combine.not_true', inputs }
      : { value: true, reason: 'combine.not_false', inputs };
  }
  if (type === 'combine.at_least' && typeof config.count === 'number' && Number.isInteger(config.count)) {
    const trueCount = children.filter((child) => child.value === true).length;
    const unknownCount = children.filter((child) => child.value === 'unknown').length;
    if (trueCount >= config.count) return { value: true, reason: 'combine.threshold_met', inputs };
    if (trueCount + unknownCount < config.count) return { value: false, reason: 'combine.threshold_unreachable', inputs };
    return { value: 'unknown', reason: 'combine.indeterminate', inputs };
  }
  return invalidCondition();
}

export function evaluateConditionNode(
  node: StrategyNode,
  context: EvaluationContext,
  children: readonly ConditionResult[] = [],
): ConditionResult {
  if (node.kind !== 'condition') return invalidCondition();
  if (node.type.startsWith('combine.')) return combineConditionResults(node.type, children, node.config);
  if (node.type === 'predicate.compare') {
    const { left, operator, right } = node.config;
    if (!isRecord(left) || !isRecord(right) || typeof operator !== 'string') return invalidCondition();
    const resolvedLeft = resolveOperand(left as Operand, context);
    const resolvedRight = resolveOperand(right as Operand, context);
    const inputs = [resolvedLeft.input, resolvedRight.input].filter((input): input is ReferencedInput => input !== undefined);
    if (!resolvedLeft.known) return { value: 'unknown', reason: resolvedLeft.reason, inputs };
    if (!resolvedRight.known) return { value: 'unknown', reason: resolvedRight.reason, inputs };
    const result = compare(operator, resolvedLeft.value, resolvedRight.value);
    if (result === undefined) return { value: 'unknown', reason: 'predicate.type_mismatch', inputs };
    return { value: result, reason: result ? 'predicate.matched' : 'predicate.not_matched', inputs };
  }
  if (node.type === 'predicate.position_state') {
    const expected = node.config.state;
    const resolved = resolveOperand({ ref: 'account.positions' }, context);
    if (!resolved.known) return { value: 'unknown', reason: resolved.reason, inputs: [resolved.input] };
    if (!Array.isArray(resolved.value) || typeof expected !== 'string') return invalidCondition();
    const positions = resolved.value.filter((position): position is Record<string, JsonValue> => (
      isRecord(position) && position.market === context.currentMarket
    ));
    const matches = expected === 'flat'
      ? positions.length === 0
      : positions.some((position) => expected === 'open' || position.side === expected);
    return {
      value: matches,
      reason: matches ? 'predicate.matched' : 'predicate.not_matched',
      inputs: resolved.input ? [resolved.input] : [],
    };
  }
  return invalidCondition();
}
