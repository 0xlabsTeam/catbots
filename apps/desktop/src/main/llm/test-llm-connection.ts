import {
  CompatibleProviderUrlSchema,
  type ConnectionTestResult,
  type LocalConfig,
} from '@catbots/contracts';

export type LlmConnectionTestOptions = {
  fetch?: typeof fetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REDIRECTS = 1;

class ResponseTooLargeError extends Error {}

export async function testLlmConnection(
  provider: LocalConfig['llm'],
  options: LlmConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
  const abortController = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxResponseBytes = Math.max(1, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  try {
    const endpoint = providerEndpoint(provider);
    const response = await requestProvider(
      options.fetch ?? fetch,
      endpoint,
      provider,
      abortController.signal,
    );

    if (!response.ok) {
      await discardResponse(response);
      return failure('LLM_CONNECTION_REJECTED', 'Provider rejected the connection test.');
    }

    let source: string;
    try {
      source = await readBoundedBody(response, maxResponseBytes, abortController);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return failure(
          'LLM_CONNECTION_RESPONSE_TOO_LARGE',
          'Provider response exceeded the connection-test limit.',
        );
      }
      throw error;
    }

    if (!isValidProviderResponse(provider.provider, source)) {
      return failure(
        'LLM_CONNECTION_INVALID_RESPONSE',
        'Provider returned an invalid connection-test response.',
      );
    }

    return { ok: true, model: provider.model };
  } catch (error) {
    if (timedOut) {
      return failure('LLM_CONNECTION_TIMEOUT', 'Provider connection test timed out.');
    }
    if (error instanceof RedirectRejectedError) {
      return failure(
        'LLM_CONNECTION_REDIRECT_REJECTED',
        'Provider redirected the connection test to a disallowed location.',
      );
    }
    if (error instanceof ResponseTooLargeError) {
      return failure(
        'LLM_CONNECTION_RESPONSE_TOO_LARGE',
        'Provider response exceeded the connection-test limit.',
      );
    }
    return failure('LLM_CONNECTION_FAILED', 'Provider connection test failed.');
  } finally {
    clearTimeout(timeout);
  }
}

class RedirectRejectedError extends Error {}

async function requestProvider(
  fetchImplementation: typeof fetch,
  initialEndpoint: URL,
  provider: LocalConfig['llm'],
  signal: AbortSignal,
): Promise<Response> {
  let endpoint = initialEndpoint;
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: providerHeaders(provider),
      body: JSON.stringify(providerBody(provider)),
      redirect: 'manual',
      signal,
    });

    if (!isRedirect(response.status)) return response;
    await discardResponse(response);
    const location = response.headers.get('location');
    if (redirects >= MAX_REDIRECTS
      || (response.status !== 307 && response.status !== 308)
      || location === null) {
      throw new RedirectRejectedError();
    }

    let redirected: URL;
    try {
      redirected = new URL(location, endpoint);
    } catch {
      throw new RedirectRejectedError();
    }
    if (redirected.origin !== initialEndpoint.origin
      || redirected.username !== ''
      || redirected.password !== ''
      || !CompatibleProviderUrlSchema.safeParse(redirected.toString()).success) {
      throw new RedirectRejectedError();
    }
    endpoint = redirected;
  }
}

function providerEndpoint(provider: LocalConfig['llm']): URL {
  const base = new URL(provider.baseUrl);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(provider.provider === 'openai-compatible' ? 'chat/completions' : 'messages', base);
}

function providerHeaders(provider: LocalConfig['llm']): Record<string, string> {
  const common = { 'content-type': 'application/json' };
  if (provider.provider === 'openai-compatible') {
    return { ...common, authorization: `Bearer ${provider.apiKey}` };
  }
  return {
    ...common,
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01',
  };
}

function providerBody(provider: LocalConfig['llm']): Record<string, unknown> {
  return {
    model: provider.model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    max_tokens: 1,
  };
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response body is never surfaced; a failed cancellation is safe to ignore.
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
  abortController: AbortController,
): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maxResponseBytes) {
        abortController.abort();
        try {
          await reader.cancel();
        } catch {
          // Aborting the request may already have errored the reader.
        }
        throw new ResponseTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isValidProviderResponse(provider: LocalConfig['llm']['provider'], source: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return false;
  }
  if (typeof value !== 'object' || value === null) return false;

  if (provider === 'openai-compatible') {
    const choices = (value as { choices?: unknown }).choices;
    return Array.isArray(choices) && choices.some((choice) => {
      if (typeof choice !== 'object' || choice === null) return false;
      const message = (choice as { message?: unknown }).message;
      return typeof message === 'object'
        && message !== null
        && typeof (message as { content?: unknown }).content === 'string';
    });
  }

  const content = (value as { content?: unknown }).content;
  return Array.isArray(content) && content.some((part) => typeof part === 'object'
    && part !== null
    && (part as { type?: unknown }).type === 'text'
    && typeof (part as { text?: unknown }).text === 'string');
}

function failure(code: string, message: string): ConnectionTestResult {
  return { ok: false, code, message };
}
