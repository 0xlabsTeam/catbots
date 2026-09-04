import { AgentToolActivitySchema, type AgentToolActivity, type WorkbenchState } from '@catbots/contracts';

import type { AgentToolCatalog, AgentToolName } from './agent-tools';
import type {
  AgentConversationMessage,
  CompatibleChatProvider,
} from '../llm/compatible-chat-provider';
import type { WorkbenchRepository } from '../workbench/workbench-repository';

export type AgentLoopErrorCode = 'AGENT_ABORTED' | 'AGENT_TOOL_ROUND_LIMIT' | 'AGENT_FAILED';

export class AgentLoopError extends Error {
  constructor(readonly code: AgentLoopErrorCode) {
    super(code === 'AGENT_ABORTED'
      ? 'Agent request was cancelled.'
      : code === 'AGENT_TOOL_ROUND_LIMIT'
        ? 'Agent exceeded the tool round limit.'
        : 'Agent request failed.');
    this.name = 'AgentLoopError';
  }
}

export type RunAgentTurnInput = Readonly<{
  botId: string;
  message: string;
  signal: AbortSignal;
}>;

export type RunAgentTurnDependencies = Readonly<{
  provider: CompatibleChatProvider;
  repository: WorkbenchRepository;
  tools: AgentToolCatalog;
  requestId: string;
  onActivity?: (activity: AgentToolActivity) => void;
}>;

const MAX_TOOL_ROUNDS = 8;
const toolNames = new Set<AgentToolName>([
  'list_nodes', 'list_data_products', 'validate_strategy', 'backtest_strategy', 'explain_strategy', 'compare_versions',
]);

export async function runAgentTurn(input: RunAgentTurnInput, dependencies: RunAgentTurnDependencies): Promise<WorkbenchState> {
  if (input.signal.aborted) throw new AgentLoopError('AGENT_ABORTED');
  const initial = dependencies.repository.getState(input.botId);
  dependencies.repository.appendChatMessage(input.botId, 'user', input.message);
  const conversation: AgentConversationMessage[] = [
    { role: 'system', content: systemPrompt(initial) },
    ...initial.messages.map(({ role, content }) => ({ role, content } as const)),
    { role: 'user', content: input.message },
  ];
  let toolRounds = 0;

  try {
    while (true) {
      assertNotAborted(input.signal);
      emit(dependencies, input.botId, { phase: 'thinking', message: 'Designing the strategy.' });
      const completion = await dependencies.provider.complete({
        messages: conversation,
        tools: dependencies.tools.definitions,
        maxTokens: 4096,
      }, input.signal);
      assertNotAborted(input.signal);

      if (completion.toolCalls.length === 0) {
        dependencies.repository.appendChatMessage(input.botId, 'assistant', completion.text);
        emit(dependencies, input.botId, { phase: 'completed', message: 'Agent response completed.' });
        return dependencies.repository.getState(input.botId);
      }
      if (toolRounds >= MAX_TOOL_ROUNDS) throw new AgentLoopError('AGENT_TOOL_ROUND_LIMIT');
      toolRounds += 1;
      conversation.push({ role: 'assistant', content: completion.text, toolCalls: completion.toolCalls });
      let completedBacktest = false;

      for (const call of completion.toolCalls) {
        const knownTool = toolNames.has(call.name as AgentToolName) ? call.name as AgentToolName : undefined;
        emit(dependencies, input.botId, {
          phase: 'tool_started',
          ...(knownTool === undefined ? {} : { tool: knownTool }),
          message: knownTool === undefined ? 'Rejecting an unavailable tool.' : `Running ${knownTool}.`,
        });
        const result = dependencies.tools.execute(call.name, call.arguments);
        if (knownTool === 'backtest_strategy' && result.ok === true) completedBacktest = true;
        conversation.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
        emit(dependencies, input.botId, {
          phase: 'tool_completed',
          ...(knownTool === undefined ? {} : { tool: knownTool }),
          message: knownTool === undefined ? 'Unavailable tool rejected.' : `${knownTool} completed.`,
        });
      }
      if (completedBacktest) {
        dependencies.repository.appendChatMessage(
          input.botId,
          'assistant',
          'Backtest completed. Review the performance, trades, warnings, and execution trace before approving this draft.',
        );
        emit(dependencies, input.botId, { phase: 'completed', message: 'Agent response completed.' });
        return dependencies.repository.getState(input.botId);
      }
    }
  } catch (error) {
    const normalized = input.signal.aborted ? new AgentLoopError('AGENT_ABORTED')
      : error instanceof AgentLoopError ? error
        : new AgentLoopError('AGENT_FAILED');
    emit(dependencies, input.botId, { phase: 'failed', message: normalized.message });
    throw normalized;
  }
}

function systemPrompt(state: WorkbenchState): string {
  const revision = state.currentRevision === null
    ? 'No strategy revision exists yet.'
    : `Current draft is v${state.currentRevision.version} with nodes: ${state.currentRevision.nodes.map(({ id, title }) => `${id} (${title})`).join(', ')}.`;
  return [
    'You are the Catbots strategy design Agent for a non-coding trader.',
    'Use only the provided tools. Never request or reveal credentials, execute code, approve revisions, or enable Paper/Live trading.',
    'A strategy must follow Trigger → Condition → Action and may combine conditions.',
    'Validate every complete structural change before describing it as a draft.',
    'Backtests use Bundled sample data and are not investment promises.',
    `Bot: ${state.bot.name}; market: ${state.bot.market}.`,
    revision,
  ].join('\n');
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentLoopError('AGENT_ABORTED');
}

function emit(
  dependencies: RunAgentTurnDependencies,
  botId: string,
  activity: Omit<AgentToolActivity, 'botId' | 'requestId'>,
): void {
  dependencies.onActivity?.(AgentToolActivitySchema.parse({ botId, requestId: dependencies.requestId, ...activity }));
}
