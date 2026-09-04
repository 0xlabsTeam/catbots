import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalConfig } from '@catbots/contracts';
import { testLlmConnection } from '../src/main/llm/test-llm-connection';

type ProviderHandler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

async function startProvider(handler: ProviderHandler): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Provider test server did not bind a TCP port');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, server };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function llm(provider: LocalConfig['llm']['provider'], baseUrl: string, apiKey: string): LocalConfig['llm'] {
  return { provider, baseUrl, apiKey, model: 'fixture-model' };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe('Main-process compatible provider connection testing', () => {
  it('probes an OpenAI-compatible chat endpoint with only bearer authentication', async () => {
    const secret = 'openai-secret-sentinel';
    let received: { path?: string; authorization?: string; xApiKey?: string; body?: string } = {};
    const { baseUrl } = await startProvider((request, response) => {
      void readRequestBody(request).then((body) => {
        received = {
          path: request.url,
          authorization: request.headers.authorization,
          xApiKey: request.headers['x-api-key'] as string | undefined,
          body,
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
      });
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await testLlmConnection({
      provider: 'openai-compatible',
      baseUrl,
      apiKey: secret,
      model: 'fixture-model',
      reasoningEffort: 'none',
    });

    expect(result).toEqual({ ok: true, model: 'fixture-model' });
    expect(received.path).toBe('/v1/chat/completions');
    expect(received.authorization).toBe(`Bearer ${secret}`);
    expect(received.xApiKey).toBeUndefined();
    expect(JSON.parse(received.body ?? '{}')).toEqual({
      model: 'fixture-model',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 1,
      reasoning_effort: 'none',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
  });

  it('probes an Anthropic-compatible messages endpoint with only x-api-key authentication', async () => {
    const secret = 'anthropic-secret-sentinel';
    let received: { path?: string; authorization?: string; xApiKey?: string; version?: string; body?: string } = {};
    const { baseUrl } = await startProvider((request, response) => {
      void readRequestBody(request).then((body) => {
        received = {
          path: request.url,
          authorization: request.headers.authorization,
          xApiKey: request.headers['x-api-key'] as string | undefined,
          version: request.headers['anthropic-version'] as string | undefined,
          body,
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }));
      });
    });

    const result = await testLlmConnection(llm('anthropic-compatible', baseUrl, secret));

    expect(result).toEqual({ ok: true, model: 'fixture-model' });
    expect(received.path).toBe('/v1/messages');
    expect(received.authorization).toBeUndefined();
    expect(received.xApiKey).toBe(secret);
    expect(received.version).toBe('2023-06-01');
    expect(JSON.parse(received.body ?? '{}')).toEqual({
      model: 'fixture-model',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 1,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('returns fixed safe failures for rejected and malformed provider responses', async () => {
    const rejectedSecret = 'rejected-body-secret';
    const rejected = await startProvider((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: rejectedSecret }));
    });
    const malformedSecret = 'malformed-body-secret';
    const malformed = await startProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ unexpected: malformedSecret }));
    });

    const rejectedResult = await testLlmConnection(llm('openai-compatible', rejected.baseUrl, 'request-secret'));
    const malformedResult = await testLlmConnection(llm('anthropic-compatible', malformed.baseUrl, 'request-secret'));

    expect(rejectedResult).toEqual({
      ok: false,
      code: 'LLM_CONNECTION_REJECTED',
      message: 'Provider rejected the connection test.',
    });
    expect(malformedResult).toEqual({
      ok: false,
      code: 'LLM_CONNECTION_INVALID_RESPONSE',
      message: 'Provider returned an invalid connection-test response.',
    });
    expect(JSON.stringify([rejectedResult, malformedResult])).not.toContain(rejectedSecret);
    expect(JSON.stringify([rejectedResult, malformedResult])).not.toContain(malformedSecret);
    expect(JSON.stringify([rejectedResult, malformedResult])).not.toContain('request-secret');
  });

  it('bounds response bytes and aborts an oversized body without exposing it', async () => {
    const secret = 'oversized-response-secret';
    const { baseUrl } = await startProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: secret.repeat(100) } }] }));
    });

    const result = await testLlmConnection(llm('openai-compatible', baseUrl, 'request-secret'), {
      maxResponseBytes: 64,
    });

    expect(result).toEqual({
      ok: false,
      code: 'LLM_CONNECTION_RESPONSE_TOO_LARGE',
      message: 'Provider response exceeded the connection-test limit.',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('request-secret');
  });

  it('times out within a bound and aborts the pending loopback request', async () => {
    let responseClosed = false;
    const { baseUrl } = await startProvider((_request, response) => {
      response.on('close', () => { responseClosed = true; });
    });

    const result = await testLlmConnection(llm('openai-compatible', baseUrl, 'timeout-secret'), {
      timeoutMs: 25,
    });

    expect(result).toEqual({
      ok: false,
      code: 'LLM_CONNECTION_TIMEOUT',
      message: 'Provider connection test timed out.',
    });
    await vi.waitFor(() => expect(responseClosed).toBe(true));
  });

  it('does not forward credentials across an origin-changing redirect', async () => {
    const secret = 'redirect-secret-sentinel';
    let redirectedRequests = 0;
    const sink = await startProvider((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
    let firstAuthorization: string | undefined;
    const source = await startProvider((request, response) => {
      firstAuthorization = request.headers.authorization;
      response.writeHead(307, { location: `${sink.baseUrl}/chat/completions` });
      response.end();
    });

    const result = await testLlmConnection(llm('openai-compatible', source.baseUrl, secret));

    expect(result).toEqual({
      ok: false,
      code: 'LLM_CONNECTION_REDIRECT_REJECTED',
      message: 'Provider redirected the connection test to a disallowed location.',
    });
    expect(firstAuthorization).toBe(`Bearer ${secret}`);
    expect(redirectedRequests).toBe(0);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('reports a fixed network failure for an unreachable provider', async () => {
    const provider = await startProvider((_request, response) => response.end());
    const address = provider.server.address();
    if (address === null || typeof address === 'string') throw new Error('Provider server has no port');
    provider.server.closeAllConnections();
    await new Promise<void>((resolve) => provider.server.close(() => resolve()));
    servers.splice(servers.indexOf(provider.server), 1);

    const result = await testLlmConnection(
      llm('openai-compatible', `http://127.0.0.1:${address.port}/v1`, 'network-secret'),
      { timeoutMs: 100 },
    );

    expect(result).toEqual({
      ok: false,
      code: 'LLM_CONNECTION_FAILED',
      message: 'Provider connection test failed.',
    });
    expect(JSON.stringify(result)).not.toContain('network-secret');
  });
});
