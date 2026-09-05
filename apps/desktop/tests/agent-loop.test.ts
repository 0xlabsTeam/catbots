import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsonValue, type AgentCompletion, type AgentCompletionRequest, type CompatibleChatProvider } from '../src/main/llm/compatible-chat-provider';

import { createAgentToolCatalog } from '../src/main/agent/agent-tools';
import { AgentLoopError, runAgentTurn } from '../src/main/agent/agent-loop';
import { BotRepository } from '../src/main/bots/bot-repository';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
import { bundledSampleDatasetCatalog } from '../src/main/workbench/sample-backtest-data';
import { WorkbenchRepository } from '../src/main/workbench/workbench-repository';

class FakeProvider implements CompatibleChatProvider {
  readonly requests: AgentCompletionRequest[] = [];
  constructor(private readonly completions: AgentCompletion[]) {}
  async complete(request: AgentCompletionRequest): Promise<AgentCompletion> {
    this.requests.push(request);
    const next = this.completions.shift();
    if (next === undefined) throw new Error('No fake completion');
    return next;
  }
}

let database: Database.Database;
let botId: string;
let repository: WorkbenchRepository;

const strategy = {
  schemaVersion: '2.0', strategy: { id: 's', name: 'Safe strategy', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 't', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '1h', alignment: 'utc' } },
    { id: 'c', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { literal: 2 }, operator: 'gt', right: { literal: 1 } } },
    { id: 'a', kind: 'action', type: 'state.set', version: 1, config: { key: 'signal', value: true } },
  ],
  edges: [
    { id: 'e1', source: 't', sourcePort: 'activation', target: 'c', targetPort: 'activation' },
    { id: 'e2', source: 'c', sourcePort: 'result', target: 'a', targetPort: 'condition' },
  ],
};

const ethRsiStrategy = {
  schemaVersion: '2.0',
  strategy: { id: 'eth-rsi', name: 'ETH RSI', version: 1 },
  marketScope: { type: 'dex_universe' },
  nodes: [
    { id: 'entry-clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
    { id: 'entry-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'ETH-PERP' } } },
    { id: 'entry-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi.14', field: 'value' }, operator: 'lt', right: { literal: 20 } } },
    { id: 'entry-all', kind: 'condition', type: 'combine.all', version: 1, config: {} },
    { id: 'entry-long', kind: 'action', type: 'execution.open_position', version: 1, config: { side: 'long', size: { type: 'quote', value: 1000 } } },
    { id: 'exit-clock', kind: 'trigger', type: 'trigger.interval', version: 1, config: { every: '15m', alignment: 'utc' } },
    { id: 'exit-symbol', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.symbol' }, operator: 'eq', right: { literal: 'ETH-PERP' } } },
    { id: 'exit-rsi', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'indicator.rsi.14', field: 'value' }, operator: 'gt', right: { literal: 80 } } },
    { id: 'exit-long', kind: 'condition', type: 'predicate.position_state', version: 2, config: { state: 'long' } },
    { id: 'exit-all', kind: 'condition', type: 'combine.all', version: 1, config: {} },
    { id: 'exit-close', kind: 'action', type: 'execution.close_position', version: 1, config: { side: 'long', percent: 100 } },
  ],
  edges: [
    { id: 'e1', source: 'entry-clock', sourcePort: 'activation', target: 'entry-symbol', targetPort: 'activation' },
    { id: 'e2', source: 'entry-clock', sourcePort: 'activation', target: 'entry-rsi', targetPort: 'activation' },
    { id: 'e3', source: 'entry-symbol', sourcePort: 'result', target: 'entry-all', targetPort: 'conditions' },
    { id: 'e4', source: 'entry-rsi', sourcePort: 'result', target: 'entry-all', targetPort: 'conditions' },
    { id: 'e5', source: 'entry-all', sourcePort: 'result', target: 'entry-long', targetPort: 'condition' },
    { id: 'e6', source: 'exit-clock', sourcePort: 'activation', target: 'exit-symbol', targetPort: 'activation' },
    { id: 'e7', source: 'exit-clock', sourcePort: 'activation', target: 'exit-rsi', targetPort: 'activation' },
    { id: 'e8', source: 'exit-clock', sourcePort: 'activation', target: 'exit-long', targetPort: 'activation' },
    { id: 'e9', source: 'exit-symbol', sourcePort: 'result', target: 'exit-all', targetPort: 'conditions' },
    { id: 'e10', source: 'exit-rsi', sourcePort: 'result', target: 'exit-all', targetPort: 'conditions' },
    { id: 'e11', source: 'exit-long', sourcePort: 'result', target: 'exit-all', targetPort: 'conditions' },
    { id: 'e12', source: 'exit-all', sourcePort: 'result', target: 'exit-close', targetPort: 'condition' },
  ],
};

function createTools() {
  return createAgentToolCatalog({
    botId,
    dex: 'hyperliquid',
    backtestDatasetCatalog: bundledSampleDatasetCatalog,
    repository,
  });
}

beforeEach(() => {
  database = openDatabase(':memory:');
  migrateDatabase(database);
  botId = new BotRepository(database).createDraft({ name: 'Bot', market: 'BTC-PERP' }).id;
  repository = new WorkbenchRepository(database);
});

afterEach(() => database.close());

describe('runAgentTurn', () => {
  it('persists a plain user/assistant exchange and emits sanitized activity', async () => {
    const provider = new FakeProvider([{ text: 'Tell me your entry rule.', toolCalls: [] }]);
    const onActivity = vi.fn();

    const state = await runAgentTurn({ botId, message: 'Build a BTC bot', signal: new AbortController().signal }, {
      provider, repository, tools: createTools(), onActivity, requestId: randomUUID(),
    });

    expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Build a BTC bot' },
      { role: 'assistant', content: 'Tell me your entry rule.' },
    ]);
    expect(onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'completed', botId }));
    expect(JSON.stringify(provider.requests)).not.toContain('apiKey');
    expect(provider.requests[0]?.messages[0]?.content).toContain('DEX: Hyperliquid; market scope: dynamic');
    expect(provider.requests[0]?.messages[0]?.content).toContain('named pair');
    expect(provider.requests[0]?.messages[0]?.content).toContain('market.symbol');
    expect(provider.requests[0]?.messages[0]?.content).toContain('broad requirement');
    expect(provider.requests[0]?.messages[0]?.content).toContain('screener');
    expect(provider.requests[0]?.messages[0]?.content).toContain('“sell ETH” means close/reduce an ETH long');
    expect(provider.requests[0]?.messages[0]?.content).toContain('opening a short requires explicit short intent');
    expect(provider.requests[0]?.messages[0]?.content).toContain('only BTC-PERP and ETH-PERP');
  });

  it('executes an allowlisted tool, feeds back its result, and never approves the draft', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'call-1', name: 'validate_strategy', arguments: parseJsonValue({ strategy }) }] },
      { text: 'Draft v1 is valid and ready to backtest.', toolCalls: [] },
    ]);

    const state = await runAgentTurn({ botId, message: 'Use this rule', signal: new AbortController().signal }, {
      provider, repository, tools: createTools(), requestId: randomUUID(),
    });

    expect(provider.requests[1]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'call-1' }));
    expect(state.currentRevision).toMatchObject({ version: 1, status: 'draft', approvedAt: null });
  });

  it('persists a named-pair RSI strategy as dynamic Strategy 2.0 without inventing a short', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'eth-rsi', name: 'validate_strategy', arguments: parseJsonValue({ strategy: ethRsiStrategy }) }] },
      { text: 'Draft v1 buys and closes ETH according to RSI.', toolCalls: [] },
    ]);

    await runAgentTurn({
      botId,
      message: 'ซื้อ ETH เมื่อ RSI <20 และขาย ETH เมื่อ RSI>80',
      signal: new AbortController().signal,
    }, {
      provider, repository, tools: createTools(), requestId: randomUUID(),
    });

    const saved = repository.getStrategyDocument(botId, 1);
    expect(saved).toMatchObject({ schemaVersion: '2.0', marketScope: { type: 'dex_universe' } });
    expect(saved.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'predicate.compare', config: expect.objectContaining({ left: { ref: 'market.symbol' }, right: { literal: 'ETH-PERP' } }) }),
      expect.objectContaining({ type: 'execution.open_position', config: expect.objectContaining({ side: 'long' }) }),
      expect.objectContaining({ type: 'execution.close_position' }),
    ]));
    expect(saved.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'execution.open_position', config: expect.objectContaining({ side: 'short' }) }),
    ]));
  });

  it('returns unknown-tool errors to the model without invoking anything else', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'bad', name: 'run_shell', arguments: {} }] },
      { text: 'That operation is not available.', toolCalls: [] },
    ]);

    await runAgentTurn({ botId, message: 'Run shell', signal: new AbortController().signal }, {
      provider, repository, tools: createTools(), requestId: randomUUID(),
    });

    expect(JSON.stringify(provider.requests[1]?.messages)).toContain('UNKNOWN_TOOL');
    expect(repository.getState(botId).revisions).toHaveLength(0);
  });

  it('finishes the turn immediately after a successful backtest instead of allowing repeated runs', async () => {
    const tools = createTools();
    tools.execute('validate_strategy', { strategy });
    const provider = new FakeProvider([{
      text: 'Running the requested backtest.',
      toolCalls: [{
        id: 'backtest-1',
        name: 'backtest_strategy',
        arguments: parseJsonValue({
          revisionVersion: 1,
          marketUniverse: { mode: 'all_available' },
          assumptions: {
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-09-01T00:00:00.000Z',
            startingCapital: '10000',
            feeRateBps: 5,
            slippageBps: 5,
          },
        }),
      }],
    }]);

    const state = await runAgentTurn({ botId, message: 'Backtest it', signal: new AbortController().signal }, {
      provider, repository, tools, requestId: randomUUID(),
    });

    expect(provider.requests).toHaveLength(1);
    expect(state.backtests).toHaveLength(1);
    expect(state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('Backtest completed'),
    });
  });

  it('stops after eight tool rounds', async () => {
    const completion = { text: '', toolCalls: [{ id: 'loop', name: 'list_nodes', arguments: {} }] } satisfies AgentCompletion;
    const provider = new FakeProvider(Array.from({ length: 9 }, () => completion));

    const run = runAgentTurn({ botId, message: 'Loop', signal: new AbortController().signal }, {
      provider, repository, tools: createTools(), requestId: randomUUID(),
    });

    await expect(run).rejects.toMatchObject({ code: 'AGENT_TOOL_ROUND_LIMIT' } satisfies Partial<AgentLoopError>);
    expect(provider.requests).toHaveLength(9);
    expect(repository.getState(botId).messages).toHaveLength(1);
  });

  it('honors cancellation before contacting the provider', async () => {
    const provider = new FakeProvider([{ text: 'No', toolCalls: [] }]);
    const controller = new AbortController();
    controller.abort();

    await expect(runAgentTurn({ botId, message: 'Cancel', signal: controller.signal }, {
      provider, repository, tools: createTools(), requestId: randomUUID(),
    })).rejects.toMatchObject({ code: 'AGENT_ABORTED' });
    expect(provider.requests).toHaveLength(0);
    expect(repository.getState(botId).messages).toHaveLength(0);
  });
});
