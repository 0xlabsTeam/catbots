export type TimedSimulationInput = Readonly<{
  occurredAt: string;
  priority: number;
  stableId: string;
}>;

function parseTimestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid timestamp: ${value}`);
  return result;
}

export class SimulationClock {
  readonly #startedAt: number;
  #current: number;

  constructor(startedAt: string) {
    this.#startedAt = parseTimestamp(startedAt);
    this.#current = this.#startedAt;
  }

  now(): string {
    return new Date(this.#current).toISOString();
  }

  elapsedMilliseconds(): number {
    return this.#current - this.#startedAt;
  }

  advanceTo(next: string): void {
    const timestamp = parseTimestamp(next);
    if (timestamp < this.#current) throw new Error(`Simulation time travel from ${this.now()} to ${next}`);
    this.#current = timestamp;
  }

  order<T extends TimedSimulationInput>(inputs: readonly T[]): readonly T[] {
    return Object.freeze([...inputs].sort((left, right) => (
      parseTimestamp(left.occurredAt) - parseTimestamp(right.occurredAt)
      || left.priority - right.priority
      || left.stableId.localeCompare(right.stableId)
    )));
  }
}
