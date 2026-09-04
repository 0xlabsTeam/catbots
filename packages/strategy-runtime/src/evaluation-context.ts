import type { JsonValue } from './strategy-schema';

export type DataQualityStatus = 'verified' | 'stale' | 'unauthorized' | 'invalid';

export type EvaluationValue<T = JsonValue> = Readonly<{
  value: T;
  provider: string;
  observedAt: string;
  freshnessSeconds: number;
  quality: Readonly<{ status: DataQualityStatus }>;
  integrityHash: string;
}>;

export type TriggerEvent = Readonly<{
  id: string;
  type: string;
  occurredAt: string;
  receivedAt: string;
  source: string;
  payload: Readonly<Record<string, JsonValue>>;
  quality: Readonly<{ status: DataQualityStatus; freshnessSeconds: number }>;
}>;

export type EvaluationContext = Readonly<{
  evaluatedAt: string;
  triggerEvent?: TriggerEvent;
  values: Readonly<Record<string, EvaluationValue>>;
}>;

export type EvaluationContextInput = Readonly<{
  evaluatedAt: string;
  triggerEvent?: TriggerEvent;
  values: Readonly<Record<string, EvaluationValue<never> | EvaluationValue<unknown>>>;
}>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createEvaluationContext(input: EvaluationContextInput): EvaluationContext {
  const snapshot = structuredClone(input) as EvaluationContext;
  return deepFreeze(snapshot);
}
