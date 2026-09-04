import type { TriggerEvent } from './evaluation-context';

export type IntervalTriggerConfig = Readonly<{ every: string; alignment: 'utc' }>;
export type EventTriggerConfig = Readonly<{
  eventType: string;
  filters: Readonly<Record<string, boolean | number | string>>;
}>;

export type TriggerInput =
  | Readonly<{ kind: 'interval'; occurredAt: string }>
  | Readonly<{ kind: 'event'; event: TriggerEvent }>;

function intervalMilliseconds(every: string): number {
  const match = /^([1-9]\d*)([mhd])$/.exec(every);
  if (!match) throw new Error(`Invalid interval: ${every}`);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid interval: ${every}`);
  return result;
}

function instant(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid timestamp: ${value}`);
  return timestamp;
}

export function intervalActivations(
  config: IntervalTriggerConfig,
  fromExclusive: string,
  toInclusive: string,
): readonly string[] {
  if (config.alignment !== 'utc') throw new Error(`Invalid interval alignment: ${config.alignment}`);
  const duration = intervalMilliseconds(config.every);
  const from = instant(fromExclusive);
  const to = instant(toInclusive);
  if (to < from) throw new Error('Interval range ends before it starts');

  const first = Math.floor(from / duration) * duration + duration;
  const activations: string[] = [];
  for (let cursor = first; cursor <= to; cursor += duration) {
    activations.push(new Date(cursor).toISOString());
  }
  return Object.freeze(activations);
}

export function matchesEventTrigger(config: EventTriggerConfig, event: TriggerEvent): boolean {
  if (event.type !== config.eventType) return false;
  const envelope = event as unknown as Readonly<Record<string, unknown>>;
  return Object.entries(config.filters).every(([key, expected]) => {
    const actual = key in envelope ? envelope[key] : event.payload[key];
    return actual === expected;
  });
}

export function matchesIntervalTrigger(config: IntervalTriggerConfig, occurredAt: string): boolean {
  if (config.alignment !== 'utc') return false;
  const duration = intervalMilliseconds(config.every);
  return instant(occurredAt) % duration === 0;
}

function occurredAt(input: TriggerInput): string {
  return input.kind === 'event' ? input.event.occurredAt : input.occurredAt;
}

function stableIdentity(input: TriggerInput): string {
  return input.kind === 'event' ? input.event.id : input.occurredAt;
}

export function deriveTriggerIdempotencyKey(triggerNodeId: string, input: TriggerInput): string {
  return `${triggerNodeId}:${input.kind}:${stableIdentity(input)}`;
}

export function orderTriggerInputs(inputs: readonly TriggerInput[]): readonly TriggerInput[] {
  return Object.freeze([...inputs].sort((left, right) => {
    const timeOrder = instant(occurredAt(left)) - instant(occurredAt(right));
    if (timeOrder !== 0) return timeOrder;
    const kindOrder = (left.kind === 'interval' ? 0 : 1) - (right.kind === 'interval' ? 0 : 1);
    if (kindOrder !== 0) return kindOrder;
    return stableIdentity(left).localeCompare(stableIdentity(right));
  }));
}
