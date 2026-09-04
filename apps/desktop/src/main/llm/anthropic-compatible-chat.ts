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

export class AnthropicCompatibleChatProvider implements CompatibleChatProvider {
  constructor(
    private readonly provider: LocalConfig['llm'],
    private readonly options: CompatibleChatProviderOptions = {},
  ) {
    if (provider.provider !== 'anthropic-compatible') throw new Error('Anthropic-compatible provider configuration required');
  }

  async complete(request: AgentCompletionRequest, signal: AbortSignal): Promise<AgentCompletion> {
    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const body: Record<string, JsonValue> = {
      model: this.provider.model,
      messages: request.messages.filter((message) => message.role !== 'system').map(toAnthropicMessage),
      max_tokens: request.maxTokens ?? 2048,
    };
    if (system.length > 0) body.system = system;
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
    }
    const response = await postProviderJson(this.provider, 'messages', body, signal, this.options);
    return parseAnthropicCompletion(response);
  }
}

function toAnthropicMessage(message: AgentConversationMessage): JsonValue {
  if (message.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }] };
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined) {
    return {
      role: 'assistant',
      content: [
        ...(message.content.length > 0 ? [{ type: 'text', text: message.content }] : []),
        ...message.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })),
      ],
    };
  }
  return { role: message.role, content: message.content };
}

function parseAnthropicCompletion(value: unknown): AgentCompletion {
  try {
    if (typeof value !== 'object' || value === null) throw new Error();
    const content = (value as { content?: unknown }).content;
    if (!Array.isArray(content)) throw new Error();
    const texts: string[] = [];
    const toolCalls: { id: string; name: string; arguments: JsonValue }[] = [];
    for (const raw of content) {
      if (typeof raw !== 'object' || raw === null) throw new Error();
      const block = raw as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (block.type === 'text') {
        if (typeof block.text !== 'string') throw new Error();
        texts.push(block.text);
      } else if (block.type === 'tool_use') {
        if (typeof block.id !== 'string' || typeof block.name !== 'string') throw new Error();
        toolCalls.push({ id: block.id, name: block.name, arguments: parseJsonValue(block.input) });
      }
    }
    return assertCompletion(texts.join(''), toolCalls);
  } catch (error) {
    if (error instanceof CompatibleChatProviderError) throw error;
    throw new CompatibleChatProviderError('PROVIDER_INVALID_RESPONSE');
  }
}
