import { describe, expect, it } from 'vitest';
import { BotSummarySchema, REDACTED_SECRET } from '@catbots/contracts';
import { createWebPreviewApi } from '../src/renderer/web-preview-api';

const settings = {
  profile: { name: 'Preview Trader', telemetry: false },
  llm: {
    provider: 'openai-compatible' as const,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'preview-secret-that-must-not-be-retained',
    model: 'preview/model',
  },
};

describe('web preview API', () => {
  it('starts at first launch and keeps only redacted provider settings after save', async () => {
    const api = createWebPreviewApi();

    expect(await api.config.getBootstrapState()).toEqual({ state: 'first-launch' });

    const saved = await api.config.patchSettings(settings);
    const bootstrap = await api.config.getBootstrapState();

    expect(saved.llm.apiKey).toBe(REDACTED_SECRET);
    expect(bootstrap).toEqual({ state: 'ready', config: saved });
    expect(JSON.stringify(bootstrap)).not.toContain(settings.llm.apiKey);
  });

  it('simulates a provider connection without requiring a network service', async () => {
    const api = createWebPreviewApi();

    await expect(api.config.testLlmConnection(settings)).resolves.toEqual({
      ok: true,
      model: 'preview/model',
    });
  });

  it('creates valid drafts and returns them from the same preview session', async () => {
    const api = createWebPreviewApi();

    const draft = await api.bots.createDraft({ name: ' BTC Flow ', market: ' BTC-PERP ' });

    expect(BotSummarySchema.parse(draft)).toEqual(draft);
    expect(draft).toMatchObject({ name: 'BTC Flow', market: 'BTC-PERP' });
    expect(draft.status).toBe('draft');
    expect(await api.bots.list()).toEqual([draft]);
  });

  it('simulates the complete workbench workflow without storing secrets', async () => {
    const api = createWebPreviewApi();
    await api.config.patchSettings(settings);
    const bot = await api.bots.createDraft({ name: 'BTC Flow', dex: 'hyperliquid' });
    const activities: string[] = [];
    const unsubscribe = api.workbench.subscribeActivity((activity) => activities.push(activity.phase));

    const drafted = await api.workbench.sendMessage({ botId: bot.id, message: 'Use ETF flow and RSI' });
    const backtest = await api.workbench.runBacktest({
      botId: bot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', startingCapital: '10000', feeRateBps: 3.5, slippageBps: 1 },
    });
    const trace = await api.workbench.getTrace({ botId: bot.id, traceId: backtest.traces[0]!.traceId });
    const approved = await api.workbench.approveRevision({ botId: bot.id, version: 1 });
    unsubscribe();

    expect(drafted.currentRevision).toMatchObject({ version: 1, status: 'draft' });
    expect(backtest).toMatchObject({ revisionVersion: 1, dataSource: 'Bundled sample data', status: 'completed' });
    expect(trace.events.map(({ type }) => type)).toEqual(['trigger.received', 'condition.evaluated', 'flow.completed']);
    expect(approved.status).toBe('approved');
    expect(activities).toContain('thinking');
    expect(activities).toContain('backtest_progress');
    expect(JSON.stringify(await api.workbench.get({ botId: bot.id }))).not.toContain(settings.llm.apiKey);
  });
});
