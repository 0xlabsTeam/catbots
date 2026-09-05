import { createAssistantMessageEventStream, type AssistantMessage, type Model, type TextContent } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { parseJsonValue, type AgentConversationMessage, type JsonValue, type CompatibleChatProvider } from '../llm/compatible-chat-provider';

// Pi delegates HTTP to our configured provider, preserving URL validation,
// bounded responses, timeouts and credential-safe errors. This descriptor is
// transport metadata, not a model selection or a token/cost estimate.
export const piTransportModel: Model<'openai-completions'> = {
  id: 'configured-provider', name: 'Configured Catbots provider',
  api: 'openai-completions', provider: 'catbots-compatible', baseUrl: '',
  reasoning: false, input: ['text'], contextWindow: 0, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export function assistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant', content: text ? [{ type: 'text', text }] : [],
    api: piTransportModel.api, provider: piTransportModel.provider, model: piTransportModel.id,
    stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

const textContent = (content: string | readonly { type: string }[]): string => typeof content === 'string'
  ? content : content.filter((part): part is TextContent => part.type === 'text').map((part) => part.text).join('');

/** Forward real provider text deltas through Pi; tools execute only after a complete response. */
export function compatiblePiStream(provider: CompatibleChatProvider): StreamFn {
  return (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        const messages: AgentConversationMessage[] = [
          { role: 'system', content: context.systemPrompt ?? '' },
          ...context.messages.map((message): AgentConversationMessage => {
            if (message.role === 'toolResult') return {
              role: 'tool', toolCallId: message.toolCallId, content: textContent(message.content),
            };
            if (message.role === 'user') return { role: 'user', content: textContent(message.content) };
            const toolCalls = message.content.filter((part) => part.type === 'toolCall')
              .map((call) => ({ id: call.id, name: call.name, arguments: parseJsonValue(call.arguments) }));
            return { role: 'assistant', content: textContent(message.content),
              ...(toolCalls.length ? { toolCalls } : {}) };
          }),
        ];
        const partial = assistantMessage('');
        partial.content = [{ type: 'text', text: '' }];
        partial.stopReason = 'pending';
        stream.push({ type: 'start', partial });
        stream.push({ type: 'text_start', contentIndex: 0, partial });
        const completion = await provider.complete({ messages, maxTokens: options?.maxTokens ?? 4096,
          onText: (delta) => {
            if (options?.signal?.aborted) return;
            (partial.content[0] as TextContent).text += delta;
            stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: { ...partial, content: [...partial.content] } });
          },
          tools: (context.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description,
            inputSchema: tool.parameters as Readonly<Record<string, JsonValue>> })),
        }, options?.signal ?? new AbortController().signal);
        const message = assistantMessage(completion.text);
        for (const call of completion.toolCalls) {
          if (call.arguments === null || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
            throw new Error('Invalid tool arguments');
          }
          message.content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments });
        }
        message.stopReason = completion.toolCalls.length ? 'toolUse' : 'stop';
        if (options?.signal?.aborted) throw new Error('Aborted');
        stream.push({ type: 'done', reason: message.stopReason, message });
      } catch {
        const error = assistantMessage('');
        error.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
        error.errorMessage = error.stopReason === 'aborted' ? 'Agent request was cancelled.' : 'Agent request failed.';
        stream.push({ type: 'error', reason: error.stopReason, error });
      }
    })();
    return stream;
  };
}
