import { describe, expect, it } from 'vitest';

import { SimulationClock } from './simulation-clock';

describe('SimulationClock', () => {
  it('advances monotonically and exposes an ISO instant', () => {
    const clock = new SimulationClock('2026-09-03T08:00:00.000Z');

    clock.advanceTo('2026-09-03T08:15:00.000Z');

    expect(clock.now()).toBe('2026-09-03T08:15:00.000Z');
    expect(clock.elapsedMilliseconds()).toBe(900_000);
  });

  it('rejects time travel and malformed instants', () => {
    const clock = new SimulationClock('2026-09-03T08:15:00.000Z');

    expect(() => clock.advanceTo('2026-09-03T08:14:59.999Z')).toThrow(/time travel/i);
    expect(() => clock.advanceTo('not-a-time')).toThrow(/timestamp/i);
  });

  it('orders equal-time inputs by priority and stable identity without mutating input', () => {
    const inputs = [
      { occurredAt: '2026-09-03T08:15:00.000Z', priority: 2, stableId: 'b' },
      { occurredAt: '2026-09-03T08:15:00.000Z', priority: 1, stableId: 'z' },
      { occurredAt: '2026-09-03T08:15:00.000Z', priority: 2, stableId: 'a' },
    ];
    const clock = new SimulationClock('2026-09-03T08:00:00.000Z');

    expect(clock.order(inputs).map((input) => input.stableId)).toEqual(['z', 'a', 'b']);
    expect(inputs.map((input) => input.stableId)).toEqual(['b', 'z', 'a']);
  });
});
