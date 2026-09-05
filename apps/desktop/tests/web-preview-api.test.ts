import { describe, expect, it } from 'vitest';
import {
  BacktestSummarySchema,
  BotSummarySchema,
  DeploymentSchema,
  PaperDeploymentViewSchema,
  REDACTED_SECRET,
  StrategyRevisionSchema,
  TraceDetailSchema,
  type RiskLimits,
} from '@catbots/contracts';
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

    const draft = await api.bots.createDraft({ name: ' BTC Flow ', dex: 'hyperliquid' });

    expect(BotSummarySchema.parse(draft)).toEqual(draft);
    expect(draft).toMatchObject({ name: 'BTC Flow', dex: 'hyperliquid' });
    expect(draft.status).toBe('draft');
    expect(await api.bots.list()).toEqual([draft]);
    await expect(api.bots.createDraft({ name: 'Old bot', market: 'ETH-PERP' } as never)).rejects.toThrow();
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

    expect(StrategyRevisionSchema.parse(drafted.currentRevision)).toMatchObject({
      version: 1,
      schemaVersion: '2.0',
      marketScope: { type: 'dex_universe' },
      status: 'draft',
    });
    expect(BacktestSummarySchema.parse(backtest)).toMatchObject({
      revisionVersion: 1,
      dataSource: 'Bundled sample data',
      status: 'completed',
      datasetCoverage: { markets: ['BTC-PERP', 'ETH-PERP'] },
      perMarket: [
        { market: 'BTC-PERP' },
        { market: 'ETH-PERP' },
      ],
    });
    const listedParent = backtest.traces.find(({ market }) => market === 'ETH-PERP')?.parentTraceId;
    expect(listedParent).toBeDefined();
    expect(backtest.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentTraceId: listedParent, market: 'BTC-PERP' }),
      expect.objectContaining({ parentTraceId: listedParent, market: 'ETH-PERP' }),
    ]));
    expect(trace.events.map(({ type }) => type)).toEqual(['trigger.received', 'condition.evaluated', 'flow.completed']);
    expect(TraceDetailSchema.parse(trace)).toEqual(trace);
    expect(approved.status).toBe('approved');
    expect(activities).toContain('thinking');
    expect(activities).toContain('backtest_progress');
    expect(JSON.stringify(await api.workbench.get({ botId: bot.id }))).not.toContain(settings.llm.apiKey);
  });

  it('uses the same dynamic deployment contracts for Paper and Live preview flows', async () => {
    const api = createWebPreviewApi();
    const configured = {
      ...settings,
      exchanges: {
        hyperliquid: {
          network: 'testnet' as const,
          accountAddress: '0x0123456789abcdef0123456789abcdef01234567',
          agentPrivateKey: 'preview-agent-secret',
        },
      },
    };
    await api.config.patchSettings(configured);
    const bot = await api.bots.createDraft({ name: 'ETH RSI', dex: 'hyperliquid' });
    await api.workbench.sendMessage({ botId: bot.id, message: 'Trade ETH RSI across the DEX universe' });
    await api.workbench.approveRevision({ botId: bot.id, version: 1 });
    const riskLimits: RiskLimits = {
      maxOrderUsd: '1000',
      maxPositionUsd: '2500',
      maxTotalExposureUsd: '5000',
      maxLeverage: 3,
      maxDailyLossUsd: '300',
      maxDrawdownPercent: 12,
      allowedSides: ['long', 'short'],
      maxOrdersPerMinute: 4,
    };

    const paper = await api.deployments.startPaper({ botId: bot.id, strategyVersion: 1, riskLimits });
    expect(PaperDeploymentViewSchema.parse(paper).deployment).toMatchObject({
      recordVersion: 2,
      dex: 'hyperliquid',
      executionVenue: 'paper',
      marketAccess: { mode: 'all_active_perpetuals' },
    });

    await api.deployments.stopPaper({ deploymentId: paper.deployment.id });
    const preflight = await api.deployments.prepareLive({ botId: bot.id, strategyVersion: 1, riskLimits, network: 'testnet' });
    const live = await api.deployments.startLive({
      botId: bot.id,
      strategyVersion: 1,
      riskLimits,
      network: 'testnet',
      confirmationBotName: bot.name,
      preflightId: preflight.id,
    });
    expect(DeploymentSchema.parse(live)).toMatchObject({
      recordVersion: 2,
      dex: 'hyperliquid',
      executionVenue: 'hyperliquid',
      marketAccess: { mode: 'all_active_perpetuals' },
    });
    expect(JSON.stringify({ paper, preflight, live })).not.toContain(configured.exchanges.hyperliquid.agentPrivateKey);
  });

  it('honors dynamic Backtest universe selection without widening dataset coverage', async () => {
    const api = createWebPreviewApi();
    const bot = await api.bots.createDraft({ name: 'ETH RSI', dex: 'hyperliquid' });
    await api.workbench.sendMessage({ botId: bot.id, message: 'Trade ETH RSI' });
    const assumptions = {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      startingCapital: '10000',
      feeRateBps: 3.5,
      slippageBps: 1,
    };

    const included = await api.workbench.runBacktest({
      botId: bot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'include', markets: ['ETH-PERP'] },
      assumptions,
    });

    expect(included.datasetCoverage.markets).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(included.perMarket.map(({ market }) => market)).toEqual(['ETH-PERP']);
    expect(included.traces.length).toBeGreaterThan(0);
    expect(included.traces.every(({ market }) => market === 'ETH-PERP')).toBe(true);
    await expect(api.workbench.runBacktest({
      botId: bot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'include', markets: ['SOL-PERP'] },
      assumptions,
    })).rejects.toThrow('Preview Backtest dataset does not cover the requested market');
  });

  it('uses point-in-time membership before ETH is listed in the bundled fixture', async () => {
    const api = createWebPreviewApi();
    const bot = await api.bots.createDraft({ name: 'ETH RSI', dex: 'hyperliquid' });
    await api.workbench.sendMessage({ botId: bot.id, message: 'Trade ETH RSI' });

    const result = await api.workbench.runBacktest({
      botId: bot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-15T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 3.5,
        slippageBps: 1,
      },
    });

    expect(result.traces.length).toBeGreaterThan(0);
    expect(new Set(result.traces.map(({ market }) => market))).toEqual(new Set(['BTC-PERP']));
    expect(result.traces.every(({ outcome }) => outcome === 'skipped')).toBe(true);
    expect(result.traces.every(({ occurredAt }) => occurredAt === '2026-08-10T00:00:00.000Z')).toBe(true);
    expect(result.traces.every(({ parentTraceId }) => parentTraceId.includes('bundled%3Abefore-eth-listing'))).toBe(true);
    expect(result.perMarket.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
    expect(result.metrics.tradeCount).toBe(0);
  });

  it('changes Backtest fan-out at the ETH listing boundary', async () => {
    const api = createWebPreviewApi();
    const bot = await api.bots.createDraft({ name: 'ETH RSI', dex: 'hyperliquid' });
    await api.workbench.sendMessage({ botId: bot.id, message: 'Trade ETH RSI' });

    const result = await api.workbench.runBacktest({
      botId: bot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: {
        from: '2026-08-15T00:00:00.000Z',
        to: '2026-08-25T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 3.5,
        slippageBps: 1,
      },
    });

    const marketsAt = (occurredAt: string) => new Set(result.traces
      .filter((trace) => trace.occurredAt === occurredAt)
      .map(({ market }) => market));
    expect(marketsAt('2026-08-20T00:00:00.000Z')).toEqual(new Set(['BTC-PERP', 'ETH-PERP']));
    expect(new Set(result.traces.map(({ occurredAt }) => occurredAt))).toEqual(new Set(['2026-08-20T00:00:00.000Z']));
    expect(result.traces.some(({ parentTraceId }) => parentTraceId.includes('bundled%3Aeth-listed'))).toBe(true);
    expect(result.traces.some(({ parentTraceId }) => parentTraceId.includes('bundled%3Aeth-overbought'))).toBe(false);
  });

  it('reports missing coverage without inventing traces outside the bundled range', async () => {
    const api = createWebPreviewApi();
    const bot = await api.bots.createDraft({ name: 'ETH RSI', dex: 'hyperliquid' });
    await api.workbench.sendMessage({ botId: bot.id, message: 'Trade ETH RSI' });

    const result = await api.workbench.runBacktest({
      botId: bot.id,
      revisionVersion: 1,
      marketUniverse: { mode: 'all_available' },
      assumptions: {
        from: '2027-01-01T00:00:00.000Z',
        to: '2027-02-01T00:00:00.000Z',
        startingCapital: '10000',
        feeRateBps: 3.5,
        slippageBps: 1,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.traces).toEqual([]);
    expect(result.metrics).toMatchObject({ tradeCount: 0, endingEquity: '10000', realizedPnl: '0' });
    expect(result.warnings).toEqual(expect.arrayContaining(['insufficient_history', 'missing_market_coverage']));
    expect(result.datasetCoverage).toEqual({
      markets: ['BTC-PERP', 'ETH-PERP'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
  });

  it('describes the generated ETH RSI strategy without implying a short entry', async () => {
    const api = createWebPreviewApi();
    const bot = await api.bots.createDraft({ name: 'ETH RSI', dex: 'hyperliquid' });
    const state = await api.workbench.sendMessage({ botId: bot.id, message: 'Trade ETH RSI' });
    const response = state.messages.at(-1)?.content ?? '';

    expect(response).toContain('dynamic Hyperliquid');
    expect(response).toContain('ETH-PERP symbol guard');
    expect(response).toContain('RSI 14 is below 20');
    expect(response).toContain('RSI 14 is above 80');
    expect(response).toContain('does not open short positions');
  });
});
