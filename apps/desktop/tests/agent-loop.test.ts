import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsonValue, type AgentCompletion, type AgentCompletionRequest, type CompatibleChatProvider } from '../src/main/llm/compatible-chat-provider';

import { createAgentToolCatalog } from '../src/main/agent/agent-tools';
import { AgentLoopError, runAgentTurn } from '../src/main/agent/agent-loop';
import { BotRepository } from '../src/main/bots/bot-repository';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';
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
  schemaVersion: '1.0', strategy: { id: 's', name: 'Safe strategy', version: 1 },
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
      provider, repository, tools: createAgentToolCatalog({ botId, market: 'BTC-PERP', repository }), onActivity, requestId: randomUUID(),
    });

    expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Build a BTC bot' },
      { role: 'assistant', content: 'Tell me your entry rule.' },
    ]);
    expect(onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'completed', botId }));
    expect(JSON.stringify(provider.requests)).not.toContain('apiKey');
  });

  it('executes an allowlisted tool, feeds back its result, and never approves the draft', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'call-1', name: 'validate_strategy', arguments: parseJsonValue({ strategy }) }] },
      { text: 'Draft v1 is valid and ready to backtest.', toolCalls: [] },
    ]);

    const state = await runAgentTurn({ botId, message: 'Use this rule', signal: new AbortController().signal }, {
      provider, repository, tools: createAgentToolCatalog({ botId, market: 'BTC-PERP', repository }), requestId: randomUUID(),
    });

    expect(provider.requests[1]?.messages).toContainEqual(expect.objectContaining({ role: 'tool', toolCallId: 'call-1' }));
    expect(state.currentRevision).toMatchObject({ version: 1, status: 'draft', approvedAt: null });
  });

  it('returns unknown-tool errors to the model without invoking anything else', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'bad', name: 'run_shell', arguments: {} }] },
      { text: 'That operation is not available.', toolCalls: [] },
    ]);

    await runAgentTurn({ botId, message: 'Run shell', signal: new AbortController().signal }, {
      provider, repository, tools: createAgentToolCatalog({ botId, market: 'BTC-PERP', repository }), requestId: randomUUID(),
    });

    expect(JSON.stringify(provider.requests[1]?.messages)).toContain('UNKNOWN_TOOL');
    expect(repository.getState(botId).revisions).toHaveLength(0);
  });

  it('stops after eight tool rounds', async () => {
    const completion = { text: '', toolCalls: [{ id: 'loop', name: 'list_nodes', arguments: {} }] } satisfies AgentCompletion;
    const provider = new FakeProvider(Array.from({ length: 9 }, () => completion));

    const run = runAgentTurn({ botId, message: 'Loop', signal: new AbortController().signal }, {
      provider, repository, tools: createAgentToolCatalog({ botId, market: 'BTC-PERP', repository }), requestId: randomUUID(),
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
      provider, repository, tools: createAgentToolCatalog({ botId, market: 'BTC-PERP', repository }), requestId: randomUUID(),
    })).rejects.toMatchObject({ code: 'AGENT_ABORTED' });
    expect(provider.requests).toHaveLength(0);
    expect(repository.getState(botId).messages).toHaveLength(0);
  });
});
