import {
  ApiRequestError,
  ExchangeClient,
  HttpTransport,
  InfoClient,
  ValidationError,
} from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';

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
  venueOrderId?: string;
  errorCode?: string;
}>;

export type HyperliquidFill = Readonly<{
  id: string;
  clientOrderId: string;
  type: 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
  occurredAt: string;
  filledQuantity?: string;
  averagePrice?: string;
}>;

export interface HyperliquidClientPort {
  getMeta(signal: AbortSignal): Promise<HyperliquidMeta>;
  getClearinghouseState(account: string, signal: AbortSignal): Promise<HyperliquidClearinghouseState>;
  getAllMids(signal: AbortSignal): Promise<Readonly<Record<string, string>>>;
  getUserRole(address: string, signal: AbortSignal): Promise<Readonly<{ role: string; data?: Readonly<{ user?: string }> }>>;
  placeOrder(input: HyperliquidOrderRequest, signal: AbortSignal): Promise<HyperliquidActionResult>;
  cancelByCloid(input: Readonly<{ asset: number; cloid: string }>, signal: AbortSignal): Promise<HyperliquidActionResult>;
  updateLeverage(input: Readonly<{ asset: number; leverage: number }>, signal: AbortSignal): Promise<HyperliquidActionResult>;
  getUserFills(account: string, signal: AbortSignal): Promise<readonly HyperliquidFill[]>;
}

type InfoFacade = {
  meta(signal?: AbortSignal): Promise<unknown>;
  clearinghouseState(input: { user: `0x${string}` }, signal?: AbortSignal): Promise<unknown>;
  allMids(signal?: AbortSignal): Promise<unknown>;
  userRole(input: { user: `0x${string}` }, signal?: AbortSignal): Promise<unknown>;
  userFills(input: { user: `0x${string}`; aggregateByTime?: boolean }, signal?: AbortSignal): Promise<unknown>;
  orderStatus(input: { user: `0x${string}`; oid: number }, signal?: AbortSignal): Promise<unknown>;
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
      return normalizeActionResponse(response);
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
    const statuses = new Map<number, Promise<Record<string, unknown>>>();
    return (await Promise.all(response.map(async (item): Promise<HyperliquidFill[]> => {
      const fill = asRecord(item);
      const oid = nonnegativeInteger(fill.oid);
      if (!statuses.has(oid)) {
        statuses.set(oid, safeInfo(() => this.info.orderStatus({ user: address(account), oid }, signal)).then(asRecord));
      }
      const status = await statuses.get(oid)!;
      const order = status.status === 'order' ? asRecord(status.order) : {};
      const detail = typeof order.order === 'object' && order.order !== null ? asRecord(order.order) : {};
      const cloid = typeof fill.cloid === 'string' ? fill.cloid : typeof detail.cloid === 'string' ? detail.cloid : undefined;
      if (cloid === undefined) return [];
      const occurredAt = new Date(nonnegativeInteger(fill.time)).toISOString();
      return [{
        id: `${requiredText(fill.hash)}:${nonnegativeInteger(fill.tid)}`,
        clientOrderId: cloid,
        type: order.status === 'filled' ? 'filled' : 'partially_filled',
        occurredAt,
        filledQuantity: decimalText(fill.sz, false),
        averagePrice: decimalText(fill.px, false),
      }];
    }))).flat();
  }
}

async function safeInfo<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch {
    throw fixedError('HYPERLIQUID_REQUEST_FAILED');
  }
}

function normalizeActionResponse(source: unknown): HyperliquidActionResult {
  const response = asRecord(source);
  const data = asRecord(asRecord(response.response).data);
  if (!Array.isArray(data.statuses) || data.statuses.length !== 1) return { status: 'unknown', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' };
  const status = data.statuses[0];
  if (typeof status === 'string') return { status: 'unknown', errorCode: 'HYPERLIQUID_OUTCOME_UNKNOWN' };
  const row = asRecord(status);
  if (typeof row.error === 'string') return { status: 'error', errorCode: 'HYPERLIQUID_REJECTED' };
  const acknowledged = row.filled ?? row.resting;
  const detail = asRecord(acknowledged);
  return { status: 'ok', ...(row.filled === undefined ? {} : { filled: true }), venueOrderId: String(nonnegativeInteger(detail.oid)) };
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
