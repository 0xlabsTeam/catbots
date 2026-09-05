import {
  ApiRequestError,
  ExchangeClient,
  HttpTransport,
  InfoClient,
  ValidationError,
} from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import type { ExecutionEvent } from '@catbots/execution-core';

import { fixedError } from './hyperliquid-normalization';

export type HyperliquidMeta = Readonly<{
  universe: readonly Readonly<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    isDelisted?: true;
  }>[];
}>;

export type HyperliquidClearinghouseState = Readonly<{
  marginSummary: Readonly<{ accountValue: string }>;
  withdrawable: string;
  assetPositions: readonly Readonly<{
    position: Readonly<{
      coin: string;
      szi: string;
      positionValue: string;
      entryPx: string;
      leverage: Readonly<{ value: number }>;
    }>;
  }>[];
}>;

export type HyperliquidOrderRequest = Readonly<{
  asset: number;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly: boolean;
  cloid: string;
}>;

export type HyperliquidActionResult = Readonly<{
  status: 'ok' | 'error' | 'unknown';
  filled?: boolean;
  partialTerminal?: 'cancelled' | 'rejected';
  filledQuantity?: string;
  originalQuantity?: string;
  filledNotionalUsd?: string;
  venueOrderId?: string;
  errorCode?: string;
}>;

export type HyperliquidFill = ExecutionEvent;

export interface HyperliquidClientPort {
  getMeta(signal: AbortSignal): Promise<HyperliquidMeta>;
  getClearinghouseState(account: string, signal: AbortSignal): Promise<HyperliquidClearinghouseState>;
  getAllMids(signal: AbortSignal): Promise<Readonly<Record<string, string>>>;
  getUserRole(address: string, signal: AbortSignal): Promise<Readonly<{ role: string; data?: Readonly<{ user?: string }> }>>;
  placeOrder(input: HyperliquidOrderRequest, signal: AbortSignal): Promise<HyperliquidActionResult>;
  cancelByCloid(input: Readonly<{ asset: number; cloid: string }>, signal: AbortSignal): Promise<HyperliquidActionResult>;
  updateLeverage(input: Readonly<{ asset: number; leverage: number }>, signal: AbortSignal): Promise<HyperliquidActionResult>;
  getUserFills(account: string, signal: AbortSignal): Promise<readonly HyperliquidFill[]>;
  getOrderExecutionEvents?(account: string, clientOrderIds: readonly string[], signal: AbortSignal): Promise<readonly HyperliquidFill[]>;
}

type InfoFacade = {
  meta(signal?: AbortSignal): Promise<unknown>;
  clearinghouseState(input: { user: `0x${string}` }, signal?: AbortSignal): Promise<unknown>;
  allMids(signal?: AbortSignal): Promise<unknown>;
  userRole(input: { user: `0x${string}` }, signal?: AbortSignal): Promise<unknown>;
  userFills(input: { user: `0x${string}`; aggregateByTime?: boolean }, signal?: AbortSignal): Promise<unknown>;
  orderStatus(input: { user: `0x${string}`; oid: number | `0x${string}` }, signal?: AbortSignal): Promise<unknown>;
};

type ExchangeFacade = {
  order(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  cancelByCloid(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  updateLeverage(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
};

type SdkFactory = Readonly<{
  createTransport(options: { isTestnet: true; timeout: number }): unknown;
  createInfo(transport: unknown): InfoFacade;
  createExchange(transport: unknown, privateKey: `0x${string}`): ExchangeFacade;
}>;

const defaultSdk: SdkFactory = {
  createTransport: (options) => new HyperliquidTestnetTransport({ timeoutMs: options.timeout }),
  createInfo: (transport) => new InfoClient({ transport: transport as HttpTransport }),
  createExchange: (transport, privateKey) => new ExchangeClient({
    transport: transport as HttpTransport,
    wallet: privateKeyToAccount(privateKey),
  }),
};

const HYPERLIQUID_TESTNET_API = 'https://api.hyperliquid-testnet.xyz';

export class HyperliquidTestnetTransport {
  readonly isTestnet = true;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: Readonly<{
    fetcher?: typeof fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
  }> = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 8_000, 250, 30_000, 'HYPERLIQUID_TIMEOUT_INVALID');
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes ?? 2_000_000, 32, 10_000_000, 'HYPERLIQUID_RESPONSE_LIMIT_INVALID');
  }

  async request<T>(endpoint: 'info' | 'exchange', payload: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      const response = await this.fetcher(`${HYPERLIQUID_TESTNET_API}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
      });
      if (!response.ok) throw fixedError('HYPERLIQUID_HTTP_ERROR');
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
        throw fixedError('HYPERLIQUID_RESPONSE_TOO_LARGE');
      }
      const source = await readBoundedBody(response, this.maxResponseBytes);
      try {
        return JSON.parse(source) as T;
      } catch {
        throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
      }
    } catch (error) {
      if (hasFixedCode(error)) throw error;
      throw fixedError(signal?.aborted === true ? 'HYPERLIQUID_REQUEST_ABORTED' : 'HYPERLIQUID_REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}

export function createHyperliquidClient(
  options: Readonly<{ agentPrivateKey: string; timeoutMs?: number }>,
  sdk: SdkFactory = defaultSdk,
): HyperliquidClientPort {
  const privateKey = privateKeyHex(options.agentPrivateKey);
  const timeout = options.timeoutMs ?? 8_000;
  if (!Number.isInteger(timeout) || timeout < 250 || timeout > 30_000) throw fixedError('HYPERLIQUID_TIMEOUT_INVALID');
  const transport = sdk.createTransport({ isTestnet: true, timeout });
  return new SdkHyperliquidClient(
    sdk.createInfo(transport),
    sdk.createExchange(transport, privateKey),
  );
}

export function createHyperliquidPublicClient(
  options: Readonly<{ timeoutMs?: number }> = {},
  sdk: SdkFactory = defaultSdk,
): HyperliquidClientPort {
  const timeout = options.timeoutMs ?? 8_000;
  if (!Number.isInteger(timeout) || timeout < 250 || timeout > 30_000) throw fixedError('HYPERLIQUID_TIMEOUT_INVALID');
  const transport = sdk.createTransport({ isTestnet: true, timeout });
  const signerRequired = async (): Promise<never> => { throw fixedError('HYPERLIQUID_SIGNER_REQUIRED'); };
  const client = new SdkHyperliquidClient(sdk.createInfo(transport), {
    order: signerRequired,
    cancelByCloid: signerRequired,
    updateLeverage: signerRequired,
  });
  return {
    getMeta: (signal) => client.getMeta(signal),
    getClearinghouseState: (account, signal) => client.getClearinghouseState(account, signal),
    getAllMids: (signal) => client.getAllMids(signal),
    getUserRole: (address, signal) => client.getUserRole(address, signal),
    getUserFills: (account, signal) => client.getUserFills(account, signal),
    getOrderExecutionEvents: (account, ids, signal) => client.getOrderExecutionEvents(account, ids, signal),
    placeOrder: signerRequired,
    cancelByCloid: signerRequired,
    updateLeverage: signerRequired,
  };
}

export async function resolveHyperliquidSignerAddress(agentPrivateKey: string): Promise<string> {
  return privateKeyToAccount(privateKeyHex(agentPrivateKey)).address.toLowerCase();
}

class SdkHyperliquidClient implements HyperliquidClientPort {
  constructor(private readonly info: InfoFacade, private readonly exchange: ExchangeFacade) {}

  async getMeta(signal: AbortSignal): Promise<HyperliquidMeta> {
    const response = asRecord(await safeInfo(() => this.info.meta(signal)));
    if (!Array.isArray(response.universe)) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
    return {
      universe: response.universe.map((item) => {
        const row = asRecord(item);
        const isDelisted = row.isDelisted;
        if (isDelisted !== undefined && isDelisted !== true) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
        return {
          name: requiredText(row.name),
          szDecimals: nonnegativeInteger(row.szDecimals),
          maxLeverage: positiveInteger(row.maxLeverage),
          ...(isDelisted === true ? { isDelisted } : {}),
        };
      }),
    };
  }

  async getClearinghouseState(account: string, signal: AbortSignal): Promise<HyperliquidClearinghouseState> {
    const response = asRecord(await safeInfo(() => this.info.clearinghouseState({ user: address(account) }, signal)));
    const marginSummary = asRecord(response.marginSummary);
    if (!Array.isArray(response.assetPositions)) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
    return {
      marginSummary: { accountValue: decimalText(marginSummary.accountValue, true) },
      withdrawable: decimalText(response.withdrawable, true),
      assetPositions: response.assetPositions.map((item) => {
        const position = asRecord(asRecord(item).position);
        const leverage = asRecord(position.leverage);
        return { position: {
          coin: requiredText(position.coin),
          szi: signedDecimalText(position.szi),
          positionValue: decimalText(position.positionValue, true),
          entryPx: decimalText(position.entryPx, false),
          leverage: { value: positiveInteger(leverage.value) },
        } };
      }),
    };
  }

  async getAllMids(signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
    const response = asRecord(await safeInfo(() => this.info.allMids(signal)));
    return Object.fromEntries(Object.entries(response).map(([coin, value]) => [coin, decimalText(value, false)]));
  }

  async getUserRole(user: string, signal: AbortSignal): Promise<Readonly<{ role: string; data?: Readonly<{ user?: string }> }>> {
    const response = asRecord(await safeInfo(() => this.info.userRole({ user: address(user) }, signal)));
    const role = requiredText(response.role);
    if (role !== 'agent') return { role };
    const data = asRecord(response.data);
    return { role, data: { user: address(data.user) } };
  }

  async placeOrder(input: HyperliquidOrderRequest, signal: AbortSignal): Promise<HyperliquidActionResult> {
    try {
      const response = await this.exchange.order({
        orders: [{
          a: input.asset, b: input.isBuy, p: input.price, s: input.size, r: input.reduceOnly,
          t: { limit: { tif: 'Ioc' } }, c: input.cloid,
        }],
        grouping: 'na',
      }, { signal });
      return normalizeActionResponse(response, input.size);
    } catch (error) {
      return rejectedOrUnknown(error);
    }
  }

  async cancelByCloid(input: Readonly<{ asset: number; cloid: string }>, signal: AbortSignal): Promise<HyperliquidActionResult> {
    try {
      await this.exchange.cancelByCloid({ cancels: [{ asset: input.asset, cloid: input.cloid }] }, { signal });
      return { status: 'ok' };
    } catch (error) {
      return rejectedOrUnknown(error);
    }
  }

  async updateLeverage(input: Readonly<{ asset: number; leverage: number }>, signal: AbortSignal): Promise<HyperliquidActionResult> {
    try {
      await this.exchange.updateLeverage({ asset: input.asset, leverage: input.leverage, isCross: true }, { signal });
      return { status: 'ok' };
    } catch (error) {
      return rejectedOrUnknown(error);
    }
  }

  async getUserFills(account: string, signal: AbortSignal): Promise<readonly HyperliquidFill[]> {
    const response = await safeInfo(() => this.info.userFills({ user: address(account), aggregateByTime: true }, signal));
    if (!Array.isArray(response)) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
    const ids = [...new Set(response.flatMap((item) => {
      try { return [nonnegativeInteger(asRecord(item).oid)]; } catch { return []; }
    }))];
    return boundedEvidence(ids, signal, async (oid) => orderExecutionEvent(
      await this.info.orderStatus({ user: address(account), oid }, signal), response,
    ));
  }

  async getOrderExecutionEvents(account: string, clientOrderIds: readonly string[], signal: AbortSignal): Promise<readonly HyperliquidFill[]> {
    // One bounded fills read enriches only the requested order identities. Failure
    // cannot discard an independently proven terminal status.
    let fills: unknown[] = [];
    try {
      const response = await this.info.userFills({ user: address(account), aggregateByTime: true }, signal);
      if (Array.isArray(response)) fills = response;
    } catch { /* Quantity/status may still be proven; missing value stays unknown. */ }
    return boundedEvidence([...new Set(clientOrderIds)], signal, async (id) => {
      if (!/^0x[a-f0-9]{32}$/i.test(id)) throw fixedError('HYPERLIQUID_ORDER_ID_INVALID');
      return orderExecutionEvent(await this.info.orderStatus({ user: address(account), oid: id as `0x${string}` }, signal), fills, id);
    });
  }
}

async function boundedEvidence<T>(items: readonly T[], signal: AbortSignal, query: (item: T) => Promise<ExecutionEvent | undefined>): Promise<ExecutionEvent[]> {
  const results: Array<ExecutionEvent | undefined> = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (!signal.aborted && next < items.length) {
      const index = next++;
      try { results[index] = await query(items[index]!); } catch { /* Isolate each unproven identity. */ }
    }
  }));
  return results.filter((event): event is ExecutionEvent => event !== undefined);
}

function orderExecutionEvent(source: unknown, fills: readonly unknown[], expectedId?: string): ExecutionEvent | undefined {
  const response = asRecord(source);
  if (response.status !== 'order') return undefined;
  const state = asRecord(response.order);
  const order = asRecord(state.order);
  const orderId = nonnegativeInteger(order.oid);
  const clientOrderId = requiredText(order.cloid);
  if (expectedId !== undefined && clientOrderId !== expectedId) throw fixedError('HYPERLIQUID_ORDER_ID_MISMATCH');
  const originalQuantity = decimalText(order.origSz, false);
  const original = Number(originalQuantity);
  const remaining = Number(decimalText(order.sz, true));
  if (remaining > original) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  const quantity = state.status === 'filled' ? original : Number((original - remaining).toFixed(12));
  const canceled = typeof state.status === 'string' && /^(canceled|scheduledCancel|internalCancel|[a-zA-Z]+Canceled)$/.test(state.status);
  const rejected = typeof state.status === 'string' && /^(rejected|[a-zA-Z]+Rejected)$/.test(state.status);
  const type: ExecutionEvent['type'] | undefined = state.status === 'filled' ? 'filled'
    : canceled ? quantity > 0 ? 'partially_filled_cancelled' : 'cancelled'
    : rejected ? quantity > 0 ? 'partially_filled_rejected' : 'rejected'
    : state.status === 'open' || state.status === 'triggered' ? quantity > 0 ? 'partially_filled' : 'acknowledged' : undefined;
  if (type === undefined) return undefined;
  let knownQuantity = 0;
  let notional = 0;
  const seen = new Set<string>();
  for (const candidate of fills) {
    try {
      const fill = asRecord(candidate);
      if (fill.cloid !== clientOrderId && fill.oid !== orderId) continue;
      const id = `${requiredText(fill.hash)}:${nonnegativeInteger(fill.tid)}`;
      if (seen.has(id)) continue;
      const size = Number(decimalText(fill.sz, false));
      const price = Number(decimalText(fill.px, false));
      seen.add(id); knownQuantity += size; notional += size * price;
    } catch { /* An unrelated/malformed trade cannot erase proven order evidence. */ }
  }
  const occurredAt = new Date(nonnegativeInteger(state.statusTimestamp)).toISOString();
  return {
    id: `order:${clientOrderId}:${type}:${occurredAt}`, clientOrderId, type, occurredAt,
    originalQuantity,
    ...(quantity <= 0 ? {} : { filledQuantity: String(quantity) }),
    ...(quantity > 0 && Math.abs(knownQuantity - quantity) <= quantity * 1e-10 && Number.isFinite(notional) && notional > 0
      ? { filledNotionalUsd: String(Number(notional.toFixed(8))), averagePrice: String(notional / quantity) } : {}),
  };
}

async function safeInfo<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch {
    throw fixedError('HYPERLIQUID_REQUEST_FAILED');
  }
}

function normalizeActionResponse(source: unknown, requestedSize: string): HyperliquidActionResult {
  const response = asRecord(source);
  const data = asRecord(asRecord(response.response).data);
  if (!Array.isArray(data.statuses) || data.statuses.length !== 1) return { status: 'unknown', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' };
  const status = data.statuses[0];
  if (typeof status === 'string') return { status: 'unknown', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' };
  const row = asRecord(status);
  if (typeof row.error === 'string') return { status: 'error', errorCode: 'HYPERLIQUID_REJECTED' };
  const acknowledged = row.filled ?? row.resting;
  const detail = asRecord(acknowledged);
  if (row.filled === undefined) return { status: 'ok', venueOrderId: String(nonnegativeInteger(detail.oid)) };
  const filledQuantity = decimalText(detail.totalSz, false);
  const originalQuantity = decimalText(requestedSize, false);
  if (Number(filledQuantity) > Number(originalQuantity)) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return { status: 'ok', filled: filledQuantity === originalQuantity || Number(filledQuantity) === Number(originalQuantity),
    ...(Number(filledQuantity) < Number(originalQuantity) ? { partialTerminal: 'cancelled' } : {}),
    filledQuantity, originalQuantity, filledNotionalUsd: String(Number(filledQuantity) * Number(decimalText(detail.avgPx, false))),
    venueOrderId: String(nonnegativeInteger(detail.oid)) };
}

function rejectedOrUnknown(error: unknown): HyperliquidActionResult {
  return error instanceof ValidationError || error instanceof ApiRequestError
    ? { status: 'error', errorCode: 'HYPERLIQUID_REJECTED' }
    : { status: 'unknown', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return value;
}

function decimalText(value: unknown, allowZero: boolean): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  }
  return value;
}

function signedDecimalText(value: unknown): string {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return Number(value);
}

function positiveInteger(value: unknown): number {
  const parsed = nonnegativeInteger(value);
  if (parsed < 1) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  return parsed;
}

function address(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw fixedError('HYPERLIQUID_ACCOUNT_INVALID');
  return value.toLowerCase() as `0x${string}`;
}

function privateKeyHex(value: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw fixedError('HYPERLIQUID_PRIVATE_KEY_INVALID');
  return value.toLowerCase() as `0x${string}`;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) throw fixedError('HYPERLIQUID_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw fixedError('HYPERLIQUID_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}

function boundedInteger(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw fixedError(code);
  return value;
}

function hasFixedCode(value: unknown): value is Error & { code: string } {
  return value instanceof Error && typeof (value as { code?: unknown }).code === 'string';
}
