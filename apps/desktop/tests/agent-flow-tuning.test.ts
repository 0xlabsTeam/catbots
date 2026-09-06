import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { runAgentTurn } from '../src/main/agent/agent-loop';
import type { AgentToolCatalog, AgentToolResult } from '../src/main/agent/agent-tools';
import type { WorkbenchRepository } from '../src/main/workbench/workbench-repository';
import type { AgentCompletion } from '../src/main/llm/compatible-chat-provider';

it('reads a historical result, edits, validates and reruns before reporting the comparison', async () => {
  const messages: { role: string; content: string }[] = [];
  const botId = randomUUID();
  const repository = {
    getState: () => ({ bot: { id: botId, name: 'Tuning test', dex: 'hyperliquid' }, currentRevision: null, messages }),
    appendChatMessage: (_bot: string, role: string, content: string) => { messages.push({ role, content }); },
  } as unknown as WorkbenchRepository;
  const names = ['run_flow_backtest', 'get_flow_backtest', 'edit_flow', 'validate_flow', 'run_flow_backtest'];
  const completions: AgentCompletion[] = [
    ...names.map((name, i) => ({ text: '', toolCalls: [{ id: `call-${i}`, name, arguments: {} }] })),
    { text: 'Compared baseline v1 with v2; v2 has lower drawdown. These are historical results.', toolCalls: [] },
  ];
  const executeAsync = vi.fn(async (name: string): Promise<AgentToolResult> => name.includes('backtest') ? { ok: true, status: 'completed', result: { finalEquity: 10001 } } : { ok: true });
  const tools: AgentToolCatalog = {
    definitions: [...new Set(names)].map(name => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })),
    execute: () => { throw new Error('Must await async tool'); }, executeAsync,
  };
  await runAgentTurn({ botId, message: 'Tune the workflow and compare backtests', signal: new AbortController().signal }, {
    repository, tools, requestId: randomUUID(), provider: { complete: async () => completions.shift()! },
  });
  expect(executeAsync.mock.calls.map(([name]) => name)).toEqual(names);
  expect(messages.at(-1)?.content).toContain('Compared baseline v1 with v2');
});
