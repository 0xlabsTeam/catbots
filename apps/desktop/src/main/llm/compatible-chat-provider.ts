import { CompatibleProviderUrlSchema, normalizeLlmProviderBaseUrl, type LocalConfig } from '@catbots/contracts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type AgentToolCall = Readonly<{
  id: string;
  name: string;
  arguments: JsonValue;
}>;

export type AgentConversationMessage =
  | Readonly<{ role: 'system' | 'user'; content: string }>
  | Readonly<{ role: 'assistant'; content: string; toolCalls?: readonly AgentToolCall[] }>
  | Readonly<{ role: 'tool'; content: string; toolCallId: string }>;

export type AgentToolDefinition = Readonly<{
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, JsonValue>>;
}>;

export type AgentCompletionRequest = Readonly<{
  messages: readonly AgentConversationMessage[];
  tools: readonly AgentToolDefinition[];
  maxTokens?: number;
}>;

export type AgentCompletion = Readonly<{
  text: string;
  toolCalls: readonly AgentToolCall[];
}>;

export interface CompatibleChatProvider {
  complete(request: AgentCompletionRequest, signal: AbortSignal): Promise<AgentCompletion>;
}

export type CompatibleChatProviderErrorCode =
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_RESPONSE_TOO_LARGE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_REDIRECT_REJECTED'
  | 'PROVIDER_ABORTED'
  | 'PROVIDER_REQUEST_FAILED';

const errorMessages: Record<CompatibleChatProviderErrorCode, string> = {
  PROVIDER_REJECTED: 'Provider rejected the request.',
  PROVIDER_INVALID_RESPONSE: 'Provider returned an invalid response.',
  PROVIDER_RESPONSE_TOO_LARGE: 'Provider response exceeded the size limit.',
  PROVIDER_TIMEOUT: 'Provider request timed out.',
  PROVIDER_REDIRECT_REJECTED: 'Provider redirected the request to a disallowed location.',
  PROVIDER_ABORTED: 'Provider request was cancelled.',
  PROVIDER_REQUEST_FAILED: 'Provider request failed.',
};

export class CompatibleChatProviderError extends Error {
  constructor(readonly code: CompatibleChatProviderErrorCode) {
    super(errorMessages[code]);
    this.name = 'CompatibleChatProviderError';
  }

  toJSON(): { name: string; code: CompatibleChatProviderErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export type CompatibleChatProviderOptions = Readonly<{
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function postProviderJson(
  provider: LocalConfig['llm'],
  endpointPath: string,
  body: JsonValue,
  signal: AbortSignal,
  options: CompatibleChatProviderOptions,
): Promise<unknown> {
  if (signal.aborted) throw new CompatibleChatProviderError('PROVIDER_ABORTED');
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  signal.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  try {
    const base = new URL(normalizeLlmProviderBaseUrl(provider.baseUrl));
    const initialEndpoint = new URL(endpointPath, base);
    const response = await requestWithRedirects(
      options.fetch ?? fetch,
      initialEndpoint,
      providerHeaders(provider),
      JSON.stringify(body),
      controller.signal,
    );
    if (!response.ok) {
      await discardResponse(response);
      throw new CompatibleChatProviderError('PROVIDER_REJECTED');
    }
    const source = await readBoundedBody(response, Math.max(1, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES), controller);
    try {
      return JSON.parse(source) as unknown;
    } catch {
      throw new CompatibleChatProviderError('PROVIDER_INVALID_RESPONSE');
    }
  } catch (error) {
    if (error instanceof CompatibleChatProviderError) throw error;
    if (timedOut) throw new CompatibleChatProviderError('PROVIDER_TIMEOUT');
    if (signal.aborted) throw new CompatibleChatProviderError('PROVIDER_ABORTED');
    throw new CompatibleChatProviderError('PROVIDER_REQUEST_FAILED');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abortFromCaller);
  }
}

async function requestWithRedirects(
  fetchImplementation: typeof fetch,
  initialEndpoint: URL,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  let endpoint = initialEndpoint;
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImplementation(endpoint, { method: 'POST', headers, body, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return response;
    await discardResponse(response);
    const location = response.headers.get('location');
    if (redirects >= MAX_REDIRECTS || ![307, 308].includes(response.status) || location === null) {
      throw new CompatibleChatProviderError('PROVIDER_REDIRECT_REJECTED');
    }
    let redirected: URL;
    try {
      redirected = new URL(location, endpoint);
    } catch {
      throw new CompatibleChatProviderError('PROVIDER_REDIRECT_REJECTED');
    }
    if (redirected.origin !== initialEndpoint.origin
      || redirected.username !== ''
      || redirected.password !== ''
      || !CompatibleProviderUrlSchema.safeParse(redirected.toString()).success) {
      throw new CompatibleChatProviderError('PROVIDER_REDIRECT_REJECTED');
    }
    endpoint = redirected;
  }
}

function providerHeaders(provider: LocalConfig['llm']): Record<string, string> {
  const common = { 'content-type': 'application/json' };
  return provider.provider === 'openai-compatible'
    ? { ...common, authorization: `Bearer ${provider.apiKey}` }
    : { ...common, 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' };
}

async function readBoundedBody(response: Response, maximumBytes: number, controller: AbortController): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new CompatibleChatProviderError('PROVIDER_RESPONSE_TOO_LARGE');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export function parseJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(parseJsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, parseJsonValue(child)]));
  }
  throw new CompatibleChatProviderError('PROVIDER_INVALID_RESPONSE');
}

export function assertCompletion(text: string, toolCalls: readonly AgentToolCall[]): AgentCompletion {
  if (text.length === 0 && toolCalls.length === 0) throw new CompatibleChatProviderError('PROVIDER_INVALID_RESPONSE');
  return { text, toolCalls };
}
