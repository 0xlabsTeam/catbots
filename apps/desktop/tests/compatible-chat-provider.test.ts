import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalConfig } from '@catbots/contracts';

import { CompatibleChatProviderError, type AgentCompletionRequest } from '../src/main/llm/compatible-chat-provider';
import { AnthropicCompatibleChatProvider } from '../src/main/llm/anthropic-compatible-chat';
import { OpenAiCompatibleChatProvider } from '../src/main/llm/openai-compatible-chat';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
const servers: Server[] = [];

async function startServer(handler: Handler): Promise<{ baseUrl: string; origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Test provider did not bind');
  const origin = `http://127.0.0.1:${address.port}`;
  return { baseUrl: `${origin}/v1`, origin };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function config(provider: LocalConfig['llm']['provider'], baseUrl: string, apiKey = 'secret-sentinel'): LocalConfig['llm'] {
  return { provider, baseUrl, apiKey, model: 'fixture-model' };
}

const request: AgentCompletionRequest = {
  messages: [
    { role: 'system', content: 'Stay inside the tool boundary.' },
    { role: 'user', content: 'Build a bot.' },
  ],
  tools: [{
    name: 'validate_strategy',
    description: 'Validate a candidate graph.',
    inputSchema: { type: 'object', properties: { strategy: { type: 'object' } }, required: ['strategy'], additionalProperties: false },
  }],
  maxTokens: 512,
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe('compatible Agent chat providers', () => {
  it('allows a slow local generation for three minutes by default', async () => {
    vi.useFakeTimers();
    try {
      let providerSignal: AbortSignal | undefined;
      const hangingFetch: typeof fetch = vi.fn(async (_input, init) => {
        providerSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          providerSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      });
      const provider = new OpenAiCompatibleChatProvider(
        config('openai-compatible', 'http://127.0.0.1:1234/v1'),
        { fetch: hangingFetch },
      );
      const failure = provider.complete(request, new AbortController().signal).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(providerSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(failure).resolves.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends an explicit reasoning effort only for an OpenAI-compatible provider configured to use it', async () => {
    let receivedBody: Record<string, unknown> = {};
    const server = await startServer((incoming, response) => {
      void readBody(incoming).then((body) => {
        receivedBody = body;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
      });
    });
    const providerConfig = { ...config('openai-compatible', server.baseUrl), reasoningEffort: 'none' as const };

    await new OpenAiCompatibleChatProvider(providerConfig).complete(request, new AbortController().signal);

    expect(receivedBody.reasoning_effort).toBe('none');
  });

  it('normalizes OpenAI-compatible messages, tools, and multiple tool calls', async () => {
    let received: { path?: string; authorization?: string; xApiKey?: string; body?: Record<string, unknown> } = {};
    const server = await startServer((incoming, response) => {
      void readBody(incoming).then((body) => {
        received = {
          path: incoming.url,
          authorization: incoming.headers.authorization,
          xApiKey: incoming.headers['x-api-key'] as string | undefined,
          body,
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: {
          content: 'I will validate it.',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'validate_strategy', arguments: '{"strategy":{"id":"one"}}' } },
            { id: 'call-2', type: 'function', function: { name: 'list_nodes', arguments: '{}' } },
          ],
        } }] }));
      });
    });

    const result = await new OpenAiCompatibleChatProvider(config('openai-compatible', server.baseUrl)).complete(request, new AbortController().signal);

    expect(received).toMatchObject({ path: '/v1/chat/completions', authorization: 'Bearer secret-sentinel' });
    expect(received.xApiKey).toBeUndefined();
    expect(received.body).toMatchObject({ model: 'fixture-model', messages: request.messages, max_tokens: 512 });
    expect(received.body?.tools).toEqual([{ type: 'function', function: {
      name: 'validate_strategy', description: 'Validate a candidate graph.', parameters: request.tools[0]?.inputSchema,
    } }]);
    expect(result).toEqual({
      text: 'I will validate it.',
      toolCalls: [
        { id: 'call-1', name: 'validate_strategy', arguments: { strategy: { id: 'one' } } },
        { id: 'call-2', name: 'list_nodes', arguments: {} },
      ],
    });
  });

  it('normalizes Anthropic-compatible system, tool definitions, and content blocks', async () => {
    let received: { authorization?: string; xApiKey?: string; version?: string; body?: Record<string, unknown> } = {};
    const server = await startServer((incoming, response) => {
      void readBody(incoming).then((body) => {
        received = {
          authorization: incoming.headers.authorization,
          xApiKey: incoming.headers['x-api-key'] as string | undefined,
          version: incoming.headers['anthropic-version'] as string | undefined,
          body,
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ content: [
          { type: 'text', text: 'Draft ready.' },
          { type: 'tool_use', id: 'tool-1', name: 'validate_strategy', input: { strategy: { id: 'one' } } },
        ] }));
      });
    });

    const result = await new AnthropicCompatibleChatProvider(config('anthropic-compatible', server.baseUrl)).complete(request, new AbortController().signal);

    expect(received).toMatchObject({ xApiKey: 'secret-sentinel', version: '2023-06-01' });
    expect(received.authorization).toBeUndefined();
    expect(received.body).toMatchObject({
      model: 'fixture-model',
      system: 'Stay inside the tool boundary.',
      messages: [{ role: 'user', content: 'Build a bot.' }],
      max_tokens: 512,
    });
    expect(received.body?.tools).toEqual([{ name: 'validate_strategy', description: 'Validate a candidate graph.', input_schema: request.tools[0]?.inputSchema }]);
    expect(result).toEqual({ text: 'Draft ready.', toolCalls: [{ id: 'tool-1', name: 'validate_strategy', arguments: { strategy: { id: 'one' } } }] });
  });

  it.each([
    ['PROVIDER_REJECTED', 401, JSON.stringify({ error: 'remote-secret-body' })],
    ['PROVIDER_INVALID_RESPONSE', 200, '{malformed remote-secret-body'],
  ])('maps remote failures to safe fixed error %s', async (code, status, body) => {
    const server = await startServer((_incoming, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
    const provider = new OpenAiCompatibleChatProvider(config('openai-compatible', server.baseUrl));

    const failure = await provider.complete(request, new AbortController().signal).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CompatibleChatProviderError);
    expect(failure).toMatchObject({ code });
    expect(JSON.stringify(failure)).not.toContain('remote-secret-body');
    expect(JSON.stringify(failure)).not.toContain('secret-sentinel');
  });

  it('follows same-origin 307 redirects but rejects origin changes before forwarding credentials', async () => {
    let finalAuthorization: string | undefined;
    const target = await startServer((incoming, response) => {
      finalAuthorization = incoming.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'should not arrive' } }] }));
    });
    let crossOriginRequests = 0;
    const source = await startServer((incoming, response) => {
      if (incoming.url === '/v1/chat/completions') {
        response.writeHead(307, { location: '/redirected' });
        response.end();
        return;
      }
      response.writeHead(307, { location: `${target.origin}/sink` });
      response.end();
      crossOriginRequests += 1;
    });

    const failure = await new OpenAiCompatibleChatProvider(config('openai-compatible', source.baseUrl)).complete(request, new AbortController().signal).catch((error: unknown) => error);

    expect(crossOriginRequests).toBe(1);
    expect(finalAuthorization).toBeUndefined();
    expect(failure).toMatchObject({ code: 'PROVIDER_REDIRECT_REJECTED' });
  });

  it('bounds response bytes and enforces timeout and caller abort', async () => {
    const oversized = await startServer((_incoming, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(200) } }] }));
    });
    const hanging = await startServer((_incoming, response) => response.on('close', () => undefined));

    const tooLarge = await new OpenAiCompatibleChatProvider(config('openai-compatible', oversized.baseUrl), { maxResponseBytes: 64 })
      .complete(request, new AbortController().signal).catch((error: unknown) => error);
    const timedOut = await new OpenAiCompatibleChatProvider(config('openai-compatible', hanging.baseUrl), { timeoutMs: 20 })
      .complete(request, new AbortController().signal).catch((error: unknown) => error);
    const controller = new AbortController();
    controller.abort();
    const aborted = await new OpenAiCompatibleChatProvider(config('openai-compatible', hanging.baseUrl))
      .complete(request, controller.signal).catch((error: unknown) => error);

    expect(tooLarge).toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
    expect(timedOut).toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(aborted).toMatchObject({ code: 'PROVIDER_ABORTED' });
  });
});
