// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/renderer/workbench/live-node-run', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/renderer/workbench/live-node-run')>();
  return { ...actual, runLiveNode: vi.fn().mockResolvedValue({
    snapshot: { source: 'Hyperliquid mainnet', market: 'ETH-PERP', fetchedAt: new Date().toISOString(), price: 2500, funding: 0, candles: {} },
    run: { runId: 'test', market: 'ETH-PERP', at: Date.now(), state: {}, orders: [], cancelOrderIds: [], trace: [{ nodeId: 'threshold', status: 'executed', inputs: {}, outputs: { value: { type: 'number', quality: 'ready', value: 30 } } }] },
  }) };
});
import { NodeConfiguration } from '../src/renderer/workbench/NodeConfiguration';
import type { ChatFlowDraft } from '@catbots/contracts';
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const node = { id: 'threshold', type: 'process.number', version: 1, config: { value: 30 } };
const draft: ChatFlowDraft = {
  botId: '018f3f75-89ab-7def-8123-456789abcdef', version: 1, status: 'building', updatedAt: '2026-09-06T00:00:00.000Z',
  document: { schemaVersion: '3.0', nodes: [node], edges: [] },
};
it('saves node-specific settings only after explicit save', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<NodeConfiguration draft={draft} node={node} onSave={save} onClose={() => {}} onDebug={() => {}} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), { target: { value: '42' } });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...node, config: { value: 42 } }));
});
it('debug shows typed output without a live data claim', async () => {
  const debug = vi.fn();
  render(<NodeConfiguration draft={draft} node={node} onClose={() => {}} onDebug={debug} />);
  fireEvent.click(screen.getByRole('button', { name: 'Execute step' }));
  await waitFor(() => expect(debug).toHaveBeenCalled());
  expect(screen.getByText('30')).toBeTruthy();
  expect(screen.getByText('ready')).toBeTruthy();
});
