import { describe, expect, it, vi } from 'vitest';
import { readProviderStream } from '../src/main/llm/provider-stream';
const frame = (value: unknown) => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\r\n\r\n`;
function response(source: string) {
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({ start(controller) {
    // Deliberately split inside UTF-8 code points and CRLF delimiters.
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
describe('provider SSE transport', () => {
  it('streams text before completion and assembles fragmented OpenAI tool calls', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'content-type': 'text/event-stream' } });
    const onText = vi.fn();
    const pending = readProviderStream(stream, 10000, 'openai', onText);
    controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: 'สวัสดี' } }] })));
    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('สวัสดี'));
    for (const event of [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_nodes', arguments: '{' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]) controller.enqueue(new TextEncoder().encode(frame(event)));
    const result = await pending;
    expect(result).toMatchObject({ choices: [{ message: { content: 'สวัสดี', tool_calls: [{ function: { name: 'list_nodes', arguments: '{}' } }] } }] });
  });
  it('handles split UTF-8 and Anthropic tool JSON', async () => {
    const onText = vi.fn();
    const events = [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ทดสอบ' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call', name: 'list_nodes', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ];
    expect(await readProviderStream(response(events.map(frame).join('')), 10000, 'anthropic', onText)).toMatchObject({ content: [{ text: 'ทดสอบ' }, { name: 'list_nodes', input: {} }] });
    expect(onText).toHaveBeenCalledWith('ทดสอบ');
  });
  it('rejects truncation, oversized streams, and missing terminal events', async () => {
    await expect(readProviderStream(response(frame({ choices: [{ finish_reason: 'length' }] }) + frame('[DONE]')), 1000, 'openai', vi.fn())).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    await expect(readProviderStream(response(frame({ choices: [{ delta: { content: 'partial' } }] })), 1000, 'openai', vi.fn())).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    await expect(readProviderStream(response(frame({ choices: [{ delta: { content: 'too long' } }] })), 10, 'openai', vi.fn())).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  });
});
