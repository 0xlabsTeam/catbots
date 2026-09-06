import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { FlowBacktestJob, FlowBacktestResult } from '@catbots/contracts';
import { backtestView, createFlowBacktestTools } from '../src/main/agent/flow-backtest-tools';
const botId = randomUUID(), jobId = randomUUID();
const settings = { market: 'ETH-PERP', from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', timeframe: '1h', startingCapital: 10000, feeBps: 3.5, slippageBps: 1 };
const job = (status: FlowBacktestJob['status']): FlowBacktestJob => ({ id: jobId, botId, version: 4, status, progress: 0, cacheHit: false });
describe('historical agent tools', () => {
  it('waits for completion, publishes progress and binds every request to the current bot', async () => {
    const command = vi.fn().mockReturnValueOnce({ backtest: job('running') }).mockReturnValue({ backtest: job('completed') });
    const progress = vi.fn();
    const result = await createFlowBacktestTools(botId, command, progress)('run_flow_backtest', { version: 4, settings }, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, status: 'completed', version: 4 });
    expect(command.mock.calls.every(([input]) => input.botId === botId)).toBe(true);
    expect(progress).toHaveBeenCalledTimes(2);
  });
  it('cancels its worker job when the chat is stopped', async () => {
    const command = vi.fn().mockReturnValue({ backtest: job('running') });
    const controller = new AbortController();
    const pending = createFlowBacktestTools(botId, command)('run_flow_backtest', { version: 4, settings }, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false });
    expect(command).toHaveBeenLastCalledWith({ action: 'cancel_backtest', botId, jobId });
  });
  it('enforces five trials and rejects invalid settings before starting work', async () => {
    const command = vi.fn().mockReturnValue({ backtest: job('completed') });
    const execute = createFlowBacktestTools(botId, command), signal = new AbortController().signal;
    expect(await execute('run_flow_backtest', { version: 4, settings: { ...settings, feeBps: -1 } }, signal)).toMatchObject({ ok: false });
    for (let i = 0; i < 5; i++) expect(await execute('run_flow_backtest', { version: 4, settings }, signal)).toMatchObject({ ok: true });
    expect(await execute('run_flow_backtest', { version: 4, settings }, signal)).toMatchObject({ ok: false });
    expect(command).toHaveBeenCalledTimes(5);
  });
  it('paginates fills without leaking unbounded documents/curves and preserves warnings and hashes', () => {
    const result = { document: {}, equityCurve: [1, 2], fills: Array.from({ length: 45 }, (_, i) => ({ orderId: String(i) })), warnings: ['OHLC simulation'], dataHash: 'data', flowHash: 'flow' } as unknown as FlowBacktestResult;
    const view = backtestView({ ...job('completed'), result }, 20, 20);
    expect(view).toMatchObject({ result: { fillCount: 45, offset: 20, nextOffset: 40, warnings: ['OHLC simulation'], dataHash: 'data', flowHash: 'flow' } });
    expect('result' in view && view.result?.fills).toHaveLength(20);
    expect(JSON.stringify(view)).not.toContain('equityCurve');
    expect(JSON.stringify(view)).not.toContain('document');
  });
  it('returns backend failures honestly and rejects cross-bot injection', async () => {
    const command = vi.fn(() => { throw new Error('Backtest not found'); });
    const execute = createFlowBacktestTools(botId, command), signal = new AbortController().signal;
    expect(await execute('get_flow_backtest', { jobId }, signal)).toMatchObject({ ok: false, error: 'Backtest not found' });
    expect(await execute('get_flow_backtest', { jobId, botId: randomUUID() }, signal)).toMatchObject({ ok: false });
    expect(command).toHaveBeenCalledTimes(1);
  });
});

it('exposes provider-compatible schemas and routes catalog calls to the shared service', async () => {
  const { createAgentToolCatalog } = await import('../src/main/agent/agent-tools');
  const { bundledSampleDatasetCatalog } = await import('../src/main/workbench/sample-backtest-data');
  const command = vi.fn().mockReturnValue({ backtest: job('completed') });
  const tools = createAgentToolCatalog({ botId, dex: 'hyperliquid', repository: {} as never, backtestDatasetCatalog: bundledSampleDatasetCatalog, backtestCommand: command });
  expect(tools.definitions.find(tool => tool.name === 'run_flow_backtest')?.inputSchema).toMatchObject({ type: 'object', properties: { settings: { type: 'object' } } });
  expect(await tools.executeAsync!('run_flow_backtest', { version: 4, settings }, new AbortController().signal)).toMatchObject({ ok: true, status: 'completed' });
  expect(command).toHaveBeenCalledWith(expect.objectContaining({ action: 'backtest_flow', botId, version: 4 }));
});
