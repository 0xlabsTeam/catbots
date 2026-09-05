import { afterEach, describe, expect, it, vi } from 'vitest';
import { executionIdempotencyKey, type PerpDexAdapter } from '@catbots/execution-core';

import { OutboxExecutor } from '../src/main/execution/outbox-executor';
import { createLiveFixture, liveIdempotencyKey } from './live-execution-fixture';

const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function adapter(receipt: Awaited<ReturnType<PerpDexAdapter['placeOrder']>>): PerpDexAdapter {
  return {
    getMarkets: vi.fn(), getBalances: vi.fn(), getPositions: vi.fn(),
    placeOrder: vi.fn().mockResolvedValue(receipt), cancelOrder: vi.fn(), updateLeverage: vi.fn(), closePosition: vi.fn(),
    getExecutionEvents: vi.fn().mockResolvedValue({ events: [], cursor: null }),
  };
}

describe('OutboxExecutor', () => {
  it('derives dynamic order identity from parent, child, market, and action', () => {
    const identity = {
      deploymentId: 'deployment-1', strategyId: 'strategy-1', strategyVersion: 2,
      parentTraceId: 'parent-1', childTraceId: 'child-1', market: 'BTC-PERP', actionNodeId: 'open',
    } as const;
    const key = executionIdempotencyKey(identity);

    expect(executionIdempotencyKey({ ...identity })).toBe(key);
    expect(executionIdempotencyKey({ ...identity, parentTraceId: 'parent-2' })).not.toBe(key);
    expect(executionIdempotencyKey({ ...identity, childTraceId: 'child-2' })).not.toBe(key);
    expect(executionIdempotencyKey({ ...identity, market: 'ETH-PERP' })).not.toBe(key);
    expect(executionIdempotencyKey({ ...identity, actionNodeId: 'close' })).not.toBe(key);
  });

  it('records a lost response as unknown and never blindly submits it twice', async () => {
    const fixture = createLiveFixture();
    databases.push(fixture.database);
    const venue = adapter({ status: 'unknown', clientOrderId: 'cb_action_1', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' });
    const executor = new OutboxExecutor({ repository: fixture.repository, adapter: venue, clock: () => new Date('2026-09-05T00:00:01.000Z'), idFactory: vi.fn().mockReturnValueOnce('submit').mockReturnValueOnce('unknown') });

    await expect(executor.runOnce(liveIdempotencyKey, new AbortController().signal)).rejects.toMatchObject({ code: 'EXECUTION_OUTCOME_UNKNOWN' });
    await expect(executor.runOnce(liveIdempotencyKey, new AbortController().signal)).rejects.toMatchObject({ code: 'EXECUTION_RECONCILIATION_REQUIRED' });

    expect(venue.placeOrder).toHaveBeenCalledTimes(1);
    expect(fixture.repository.getOutboxItem(liveIdempotencyKey)).toMatchObject({ status: 'unknown', attempts: 1 });
    expect(fixture.repository.listAuditEvents(fixture.proposal.trace.id).map(({ type }) => type)).toEqual([
      'action.proposed', 'risk.approved', 'execution.queued', 'execution.submitted', 'execution.unknown',
    ]);
    expect(fixture.repository.listAuditEvents(fixture.proposal.trace.id).every((event) => (
      event.parentTraceId === 'parent:interval-1'
      && event.market === 'BTC-PERP'
      && event.dex === 'hyperliquid'
      && event.universeRevision === 'sha256:live-universe'
      && event.contextObservedAt === '2026-09-05T00:00:00.000Z'
    ))).toBe(true);
  });

  it('does not call the venue when the durable submission audit cannot be written', async () => {
    const fixture = createLiveFixture();
    databases.push(fixture.database);
    fixture.database.exec(`CREATE TRIGGER break_submission_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit offline'); END;`);
    const venue = adapter({ status: 'acknowledged', clientOrderId: 'cb_action_1', venueOrderId: '42' });
    const executor = new OutboxExecutor({ repository: fixture.repository, adapter: venue });

    await expect(executor.runOnce(liveIdempotencyKey, new AbortController().signal)).rejects.toThrow(/audit offline/i);

    expect(venue.placeOrder).not.toHaveBeenCalled();
    expect(fixture.repository.getOutboxItem(liveIdempotencyKey)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('replaces raw adapter error text with a fixed audit-safe code', async () => {
    const fixture = createLiveFixture();
    databases.push(fixture.database);
    const venue = adapter({
      status: 'rejected', clientOrderId: 'cb_action_1', errorCode: 'provider said api-key=secret-sentinel',
    });
    const executor = new OutboxExecutor({ repository: fixture.repository, adapter: venue });

    await executor.runOnce(liveIdempotencyKey, new AbortController().signal);

    const serialized = JSON.stringify(fixture.repository.listAuditEvents(fixture.proposal.trace.id));
    expect(serialized).not.toContain('secret-sentinel');
    expect(serialized).toContain('ADAPTER_REJECTED');
  });

  it('submits every action on a shared child trace before closing it exactly once', async () => {
    const fixture = createLiveFixture();
    databases.push(fixture.database);
    const second = fixture.proposal;
    fixture.repository.proposeLiveAction({
      trace: second.trace,
      events: [
        { ...second.events[0], id: 'action-2', sequence: 4, nodeId: 'open-2', summary: 'Second action proposed.' },
        { ...second.events[1], id: 'risk-2', sequence: 5, nodeId: 'open-2', summary: 'Second risk approved.' },
      ],
      outbox: {
        ...second.outbox, id: '158f3f75-89ab-7def-8123-456789abcdef', actionNodeId: 'open-2',
        idempotencyKey: 'sha256:action-2', clientOrderId: 'cb_action_2',
        intent: { ...second.outbox.intent, clientOrderId: 'cb_action_2' },
      },
    });
    const venue = adapter({ status: 'acknowledged', clientOrderId: 'cb_action_1', venueOrderId: 'one' });
    vi.mocked(venue.placeOrder)
      .mockResolvedValueOnce({ status: 'filled', clientOrderId: 'cb_action_1', venueOrderId: 'one' })
      .mockResolvedValueOnce({ status: 'filled', clientOrderId: 'cb_action_2', venueOrderId: 'two' });
    const executor = new OutboxExecutor({ repository: fixture.repository, adapter: venue });

    await executor.runOnce(liveIdempotencyKey, new AbortController().signal);
    expect(fixture.repository.listAuditEvents(second.trace.id).some(({ type }) => type.startsWith('flow.'))).toBe(false);
    const appendTerminal = vi.spyOn(fixture.repository, 'appendTerminalTrace')
      .mockImplementationOnce(() => { throw new Error('simulated crash before terminal trace'); });
    await expect(executor.runOnce('sha256:action-2', new AbortController().signal)).rejects.toThrow(/simulated crash/i);
    expect(fixture.repository.getOutboxItem('sha256:action-2')).toMatchObject({ status: 'acknowledged' });
    expect(fixture.repository.listAuditEvents(second.trace.id).some(({ type }) => type.startsWith('flow.'))).toBe(false);
    appendTerminal.mockRestore();
    await executor.runOnce('sha256:action-2', new AbortController().signal);
    await executor.runOnce(liveIdempotencyKey, new AbortController().signal);

    expect(venue.placeOrder).toHaveBeenCalledTimes(2);
    expect(fixture.repository.listAuditEvents(second.trace.id).filter(({ type }) => type.startsWith('flow.')))
      .toEqual([expect.objectContaining({ type: 'flow.completed' })]);
  });
});
