import { describe, expect, it } from 'vitest';

import { clientOrderId, executionIdempotencyKey } from './idempotency';

const input = {
  deploymentId: 'dep-1',
  strategyId: 's1',
  strategyVersion: 2,
  traceId: 'trace-1',
  actionNodeId: 'open',
  effectIdempotencyKey: 'effect-1',
} as const;

describe('execution IDs', () => {
  it('derives a stable key from the complete action identity', () => {
    expect(executionIdempotencyKey(input)).toBe(
      'sha256:8d4515f4a97bc3a18bc5b7bccf9507facb6cbfeb63e6a38365ec12cac8bdb924',
    );
    expect(executionIdempotencyKey(structuredClone(input))).toBe(executionIdempotencyKey(input));
    expect(executionIdempotencyKey({ ...input, actionNodeId: 'close' })).not.toBe(executionIdempotencyKey(input));
  });

  it('derives a deterministic venue-safe client order ID', () => {
    expect(clientOrderId(input)).toBe('cb_8d4515f4a97bc3a18bc5b7bccf95');
    expect(clientOrderId(input)).toMatch(/^cb_[a-f0-9]{28}$/);
  });
});
