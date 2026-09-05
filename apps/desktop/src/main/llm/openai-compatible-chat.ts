import { readProviderStream } from './provider-stream';
import type { LocalConfig } from '@catbots/contracts';
import {
  CompatibleChatProviderError,
  assertCompletion,
  parseJsonValue,
  postProviderJson,
  type AgentCompletion,
  type AgentCompletionRequest,
  type AgentConversationMessage,
  type CompatibleChatProvider,
  type CompatibleChatProviderOptions,
  type JsonValue,
} from './compatible-chat-provider';

export class OpenAiCompatibleChatProvider implements CompatibleChatProvider {
  constructor(
    private readonly provider: LocalConfig['llm'],
    private readonly options: CompatibleChatProviderOptions = {},
  ) {
    if (provider.provider !== 'openai-compatible') throw new Error('OpenAI-compatible provider configuration required');
  }

  async complete(request: AgentCompletionRequest, signal: AbortSignal): Promise<AgentCompletion> {
    const body: Record<string, JsonValue> = {
      model: this.provider.model,
      ...(request.onText ? { stream: true } : {}),
      messages: request.messages.map(toOpenAiMessage),
      max_tokens: request.maxTokens ?? 2048,
      ...(this.provider.provider === 'openai-compatible' && this.provider.reasoningEffort !== undefined
        ? { reasoning_effort: this.provider.reasoningEffort }
        : {}),
    };
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      }));
    }
    const response = await postProviderJson(this.provider, 'chat/completions', body, signal, this.options, request.onText
      ? (response, limit) => readProviderStream(response, limit, 'openai', request.onText!) : undefined);
    return parseOpenAiCompletion(response);
  }
}

function toOpenAiMessage(message: AgentConversationMessage): JsonValue {
  if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function parseOpenAiCompletion(value: unknown): AgentCompletion {
  try {
    if (typeof value !== 'object' || value === null) throw new Error();
    const choices = (value as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || typeof choices[0] !== 'object' || choices[0] === null) throw new Error();
    const message = (choices[0] as { message?: unknown }).message;
    if (typeof message !== 'object' || message === null) throw new Error();
    const rawContent = (message as { content?: unknown }).content;
    if (rawContent !== null && rawContent !== undefined && typeof rawContent !== 'string') throw new Error();
    const rawCalls = (message as { tool_calls?: unknown }).tool_calls;
    if (rawCalls !== undefined && !Array.isArray(rawCalls)) throw new Error();
    const toolCalls = (rawCalls ?? []).map((raw) => {
      if (typeof raw !== 'object' || raw === null) throw new Error();
      const source = raw as { id?: unknown; type?: unknown; function?: unknown };
      if (typeof source.id !== 'string' || source.type !== 'function' || typeof source.function !== 'object' || source.function === null) throw new Error();
      const fn = source.function as { name?: unknown; arguments?: unknown };
      if (typeof fn.name !== 'string' || typeof fn.arguments !== 'string') throw new Error();
      return { id: source.id, name: fn.name, arguments: parseJsonValue(JSON.parse(fn.arguments) as unknown) };
    });
    return assertCompletion(rawContent ?? '', toolCalls);
  } catch (error) {
    if (error instanceof CompatibleChatProviderError) throw error;
    throw new CompatibleChatProviderError('PROVIDER_INVALID_RESPONSE');
  }
}
