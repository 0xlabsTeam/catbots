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
  market?: string;
  occurredAt: string;
  receivedAt: string;
  source: string;
  payload: Readonly<Record<string, JsonValue>>;
  quality: Readonly<{ status: DataQualityStatus; freshnessSeconds: number }>;
}>;

export type EvaluationContext = Readonly<{
  evaluatedAt: string;
  currentMarket: string;
  triggerEvent?: TriggerEvent;
  values: Readonly<Record<string, EvaluationValue>>;
}>;

export type EvaluationContextInput = Readonly<{
  evaluatedAt: string;
  currentMarket: string;
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
  if (input.currentMarket.length === 0 || input.currentMarket !== input.currentMarket.trim()) {
    throw new Error('currentMarket must be a non-empty normalized market symbol');
  }
  const suppliedMarketSymbol = input.values['market.symbol'];
  if (suppliedMarketSymbol !== undefined && suppliedMarketSymbol.value !== input.currentMarket) {
    throw new Error('market.symbol must match currentMarket');
  }

  const snapshot = structuredClone({
    ...input,
    values: {
      ...input.values,
      'market.symbol': {
        value: input.currentMarket,
        provider: 'strategy-runtime',
        observedAt: input.evaluatedAt,
        freshnessSeconds: 0,
        quality: { status: 'verified' as const },
        integrityHash: `bound:market.symbol:${input.currentMarket}`,
      },
    },
  }) as EvaluationContext;
  return deepFreeze(snapshot);
}
