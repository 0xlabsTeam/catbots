import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerpDexAdapter } from '@catbots/execution-core';

import { OutboxExecutor } from '../src/main/execution/outbox-executor';
import { ReconciliationService } from '../src/main/execution/reconciliation-service';
import { toHyperliquidCloid } from '../src/main/execution/hyperliquid/hyperliquid-normalization';
import { createLiveFixture, liveClientOrderId, liveDeploymentId, liveIdempotencyKey } from './live-execution-fixture';

const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe('ReconciliationService', () => {
  it('reconciles an unknown receipt from fills without placing a second order', async () => {
    const fixture = createLiveFixture();
    databases.push(fixture.database);
    const venue: PerpDexAdapter = {
      getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn().mockResolvedValue({ status: 'unknown', clientOrderId: liveClientOrderId }),
      cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(),
      getExecutionEvents: vi.fn().mockResolvedValue({
        events: [{ id: 'fill-1', clientOrderId: toHyperliquidCloid(liveClientOrderId), type: 'filled', occurredAt: '2026-09-05T00:00:02.000Z', filledQuantity: '0.005', averagePrice: '100000' }],
        cursor: '2026-09-05T00:00:02.000Z',
      }),
    };
    const clock = () => new Date('2026-09-05T00:00:01.000Z');
    const executor = new OutboxExecutor({ repository: fixture.repository, adapter: venue, clock });
    await executor.runOnce(liveIdempotencyKey, new AbortController().signal).catch(() => undefined);

    const service = new ReconciliationService({ repository: fixture.repository, adapter: venue, account: '0x0123456789abcdef0123456789abcdef01234567' });
    await service.reconcileDeployment(liveDeploymentId, new AbortController().signal);

    expect(venue.placeOrder).toHaveBeenCalledTimes(1);
    expect(fixture.repository.getOutboxItem(liveIdempotencyKey)).toMatchObject({ status: 'acknowledged' });
    expect(fixture.repository.listAuditEvents(fixture.proposal.trace.id).at(-1)).toMatchObject({
      type: 'flow.completed', parentTraceId: 'parent:interval-1', market: 'BTC-PERP',
      dex: 'hyperliquid', universeRevision: 'sha256:live-universe',
    });
  });

  it('suspends Live execution when an unknown order cannot be proven safe', async () => {
    const fixture = createLiveFixture();
    databases.push(fixture.database);
    const venue: PerpDexAdapter = {
      getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn().mockResolvedValue({ status: 'unknown', clientOrderId: liveClientOrderId }),
      cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(),
      getExecutionEvents: vi.fn().mockResolvedValue({ events: [], cursor: null }),
    };
    const executor = new OutboxExecutor({ repository: fixture.repository, adapter: venue });
    await executor.runOnce(liveIdempotencyKey, new AbortController().signal).catch(() => undefined);

    const service = new ReconciliationService({ repository: fixture.repository, adapter: venue, account: '0x0123456789abcdef0123456789abcdef01234567' });
    await service.reconcileDeployment(liveDeploymentId, new AbortController().signal);

    expect(venue.getExecutionEvents).toHaveBeenCalled();
    expect(venue.getPositions).toHaveBeenCalled();
    expect(fixture.repository.getDeployment(liveDeploymentId)).toMatchObject({ status: 'suspended' });
    expect(venue.placeOrder).toHaveBeenCalledTimes(1);
  });
});
