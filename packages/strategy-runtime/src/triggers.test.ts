import { describe, expect, it } from 'vitest';

import {
  deriveTriggerIdempotencyKey,
  intervalActivations,
  matchesEventTrigger,
  orderTriggerInputs,
  type TriggerInput,
} from './triggers';
import type { TriggerEvent } from './evaluation-context';

const etfEvent: TriggerEvent = {
  id: 'evt-etf-1',
  type: 'data.etf_flow.updated',
  market: 'BTC-PERP',
  occurredAt: '2026-09-03T08:15:00.000Z',
  receivedAt: '2026-09-03T08:15:03.000Z',
  source: 'provider.etf_flow',
  payload: { asset: 'BTC', usd: 250_000_000 },
  quality: { status: 'verified', freshnessSeconds: 3 },
};

describe('intervalActivations', () => {
  it('emits UTC-aligned instants after the start and through the end boundary', () => {
    expect(intervalActivations(
      { every: '15m', alignment: 'utc' },
      '2026-09-03T08:00:00.000Z',
      '2026-09-03T08:45:00.000Z',
    )).toEqual([
      '2026-09-03T08:15:00.000Z',
      '2026-09-03T08:30:00.000Z',
      '2026-09-03T08:45:00.000Z',
    ]);
  });

  it('aligns an unaligned range to the epoch-based UTC cadence', () => {
    expect(intervalActivations(
      { every: '15m', alignment: 'utc' },
      '2026-09-03T08:07:00.000Z',
      '2026-09-03T08:31:00.000Z',
    )).toEqual([
      '2026-09-03T08:15:00.000Z',
      '2026-09-03T08:30:00.000Z',
    ]);
  });

  it.each(['0m', '30s', 'minute', ''])('rejects an invalid MVP interval %j', (every) => {
    expect(() => intervalActivations(
      { every, alignment: 'utc' },
      '2026-09-03T08:00:00.000Z',
      '2026-09-03T08:30:00.000Z',
    )).toThrow(/interval/i);
  });
});

describe('matchesEventTrigger', () => {
  it('matches the registered event type and equality filters in its payload', () => {
    expect(matchesEventTrigger({
      eventType: 'data.etf_flow.updated',
      filters: { asset: 'BTC' },
    }, etfEvent)).toBe(true);
  });

  it('rejects a different type or filtered payload value', () => {
    expect(matchesEventTrigger({ eventType: 'market.trade', filters: {} }, etfEvent)).toBe(false);
    expect(matchesEventTrigger({
      eventType: 'data.etf_flow.updated',
      filters: { asset: 'ETH' },
    }, etfEvent)).toBe(false);
  });

  it('requires a market for market-scoped Events and permits DEX-scoped Events without one', () => {
    const dexEvent = { ...etfEvent, market: undefined };

    expect(matchesEventTrigger({
      eventType: 'data.etf_flow.updated', filters: { asset: 'BTC' },
    }, dexEvent)).toBe(false);
    expect(matchesEventTrigger({
      eventType: 'data.etf_flow.updated', filters: { asset: 'BTC' }, scope: 'dex',
    }, dexEvent)).toBe(true);
  });
});

describe('trigger determinism', () => {
  it('separates colon-bearing Trigger and Event identity components', () => {
    const first = deriveTriggerIdempotencyKey('t', { kind: 'event', event: { ...etfEvent, id: 'a:event:b' } });
    const second = deriveTriggerIdempotencyKey('t:event:a', { kind: 'event', event: { ...etfEvent, id: 'b' } });
    expect(first).not.toBe(second);
  });
  it('derives repeatable keys from the Trigger node and source identity', () => {
    expect(deriveTriggerIdempotencyKey('t-etf', { kind: 'event', event: etfEvent })).toBe(
      'trigger:v2:t-etf:event:evt-etf-1',
    );
    expect(deriveTriggerIdempotencyKey('t-15m', {
      kind: 'interval',
      occurredAt: '2026-09-03T08:15:00.000Z',
    })).toBe('trigger:v2:t-15m:interval:2026-09-03T08%3A15%3A00.000Z');
  });

  it('uses source kind and stable identity to order equal timestamps', () => {
    const inputs: TriggerInput[] = [
      { kind: 'event', event: { ...etfEvent, id: 'evt-b' } },
      { kind: 'interval', occurredAt: etfEvent.occurredAt },
      { kind: 'event', event: { ...etfEvent, id: 'evt-a' } },
    ];

    expect(orderTriggerInputs(inputs).map((input) => (
      input.kind === 'event' ? input.event.id : input.kind
    ))).toEqual(['interval', 'evt-a', 'evt-b']);
  });
});
