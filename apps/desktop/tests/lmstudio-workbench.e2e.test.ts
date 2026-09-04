import { afterEach, describe, expect, it } from 'vitest';

import { BotRepository } from '../src/main/bots/bot-repository';
import { migrateDatabase } from '../src/main/storage/migrations';
import { openDatabase } from '../src/main/storage/database';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';
import { WorkbenchService } from '../src/main/workbench/workbench-service';

const runAgainstLocalModel = process.env.CATBOTS_LMSTUDIO_E2E === '1' ? describe : describe.skip;

runAgainstLocalModel('LM Studio workbench', () => {
  const databases: ReturnType<typeof openDatabase>[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('creates and backtests a complex combined-condition bot with the real local model', async () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    migrateDatabase(database);
    const bot = new BotRepository(database).createDraft({
      name: 'Complex local model bot',
      market: 'BTC-PERP',
    });
    const repository = new WorkbenchRepository(database);
    const service = new WorkbenchService({
      repository,
      configRepository: {
        load: async () => ({
          profile: { name: 'LM Studio E2E', telemetry: false },
          llm: {
            provider: 'openai-compatible' as const,
            baseUrl: process.env.CATBOTS_LMSTUDIO_URL ?? 'http://127.0.0.1:1234/v1',
            apiKey: 'lm-studio',
            model: process.env.CATBOTS_LMSTUDIO_MODEL ?? 'qwen/qwen3.8-27b',
            reasoningEffort: 'none' as const,
          },
          exchanges: {},
        }),
      },
    });

    const state = await service.sendMessage({
      botId: bot.id,
      message: [
        'Create a complex BTC-PERP strategy and run its backtest.',
        'Use a 15 minute interval entry flow. Open a 2x long position with 10% of equity and a 5% stop loss only when the position is flat AND at least two of these are true: RSI 14 is below 35, funding is below zero, and BTC ETF daily net flow is positive.',
        'Add a separate ETF-flow update event flow that closes the whole position when BTC ETF daily net flow is negative.',
        'Discover the available nodes and data products first, validate the complete strategy, then backtest the saved revision with $10,000 initial capital, 5 bps fees, and 5 bps slippage.',
      ].join(' '),
    });

    expect(state.currentRevision).not.toBeNull();
    expect(state.currentRevision?.nodes.filter(({ kind }) => kind === 'trigger')).toHaveLength(2);
    expect(state.currentRevision?.nodes.some(({ type }) => type === 'combine.all')).toBe(true);
    expect(state.currentRevision?.nodes.some(({ type }) => type === 'combine.at_least')).toBe(true);
    expect(state.currentRevision?.nodes.some(({ type }) => type === 'execution.open_position')).toBe(true);
    expect(state.currentRevision?.nodes.some(({ type }) => type === 'execution.close_position')).toBe(true);
    expect(state.currentRevision?.nodes.some(({ summary }) => summary.includes('indicator.rsi.14.value'))).toBe(true);
    expect(state.currentRevision?.nodes.some(({ summary }) => summary.includes('market.funding.rate'))).toBe(true);
    expect(state.currentRevision?.nodes.some(({ summary }) => summary.includes('data.etf_flow.btc.net_daily.usd'))).toBe(true);
    expect(state.backtests).toHaveLength(1);
    expect(state.backtests[0]).toMatchObject({ status: 'completed', revisionVersion: 1 });
    expect(state.backtests[0]?.metrics.tradeCount).toBeGreaterThan(0);
    expect(state.backtests[0]?.traces.some(({ outcome }) => outcome === 'executed')).toBe(true);
    expect(state.backtests[0]?.traces.length).toBeGreaterThan(0);
  }, 360_000);
});
