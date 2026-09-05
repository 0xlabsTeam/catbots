import { CompatibleChatProviderError } from './compatible-chat-provider';

/** Bounded SSE reader: handles UTF-8/chunk boundaries and rejects incomplete streams. */
export async function readProviderStream(response: Response, maximumBytes: number, kind: 'openai' | 'anthropic', onText: (delta: string) => void): Promise<unknown> {
  const invalid = () => new CompatibleChatProviderError('PROVIDER_INVALID_RESPONSE');
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', bytes = 0, ended = false, finished = false;
  const calls = new Map<number, { id: string; name: string; arguments: string; input?: unknown }>();
  const consume = (data: string) => {
    if (data === '[DONE]') { ended = true; return; }
    const event = JSON.parse(data);
    if (event.error || event.type === 'error') throw invalid();
    if (kind === 'openai') {
      const choice = event.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason != null) {
        if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw invalid();
        finished = true;
      }
      const delta = choice.delta;
      if (typeof delta?.content === 'string') { text += delta.content; onText(delta.content); }
      for (const part of delta?.tool_calls ?? []) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index > 100) throw invalid();
        const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
        call.id += part.id ?? '';
        call.name += part.function?.name ?? '';
        call.arguments += part.function?.arguments ?? '';
        calls.set(part.index, call);
      }
    } else {
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        calls.set(event.index, { id: event.content_block.id, name: event.content_block.name, arguments: '', input: event.content_block.input });
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') { text += event.delta.text; onText(event.delta.text); }
        if (event.delta?.type === 'input_json_delta') {
          const call = calls.get(event.index);
          if (!call) throw invalid();
          call.arguments += event.delta.partial_json;
        }
      }
      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        if (!['end_turn', 'tool_use', 'stop_sequence'].includes(event.delta.stop_reason)) throw invalid();
        finished = true;
      }
      if (event.type === 'message_stop') ended = true;
    }
  };
  try {
    while (!ended) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new CompatibleChatProviderError('PROVIDER_RESPONSE_TOO_LARGE');
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize after buffering, so CRLF split across network chunks stays intact.
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) consume(data);
        if (ended) break;
      }
    }
    if (!ended || !finished) throw invalid();
    const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (kind === 'openai') return { choices: [{ message: { content: text, tool_calls: ordered.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } }] };
    return { content: [{ type: 'text', text }, ...ordered.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments ? JSON.parse(call.arguments) : call.input }))] };
  } catch (error) {
    if (error instanceof CompatibleChatProviderError) throw error;
    throw invalid();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
