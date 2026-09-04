import { createHash } from 'node:crypto';
import { formatPrice, formatSize } from '@nktkas/hyperliquid/utils';

export function toCatbotsMarket(coin: string): string {
  return `${coin}-PERP`;
}

export function toHyperliquidCoin(market: string): string {
  if (!market.endsWith('-PERP') || market.length <= 5) throw fixedError('HYPERLIQUID_MARKET_INVALID');
  return market.slice(0, -5);
}

export function toHyperliquidCloid(clientOrderId: string): string {
  return `0x${createHash('sha256').update(clientOrderId).digest('hex').slice(0, 32)}`;
}

export function decimal(value: number, maximumDecimals = 8): string {
  if (!Number.isFinite(value) || value <= 0) throw fixedError('HYPERLIQUID_DECIMAL_INVALID');
  return Number(value.toFixed(maximumDecimals)).toString();
}

export function formatOrderPrice(value: number, sizeDecimals: number): string {
  try {
    return formatPrice(value, sizeDecimals, 'perp');
  } catch {
    throw fixedError('HYPERLIQUID_PRICE_INVALID');
  }
}

export function formatOrderSize(value: number, sizeDecimals: number): string {
  try {
    return formatSize(value, sizeDecimals);
  } catch {
    throw fixedError('HYPERLIQUID_SIZE_INVALID');
  }
}

export function fixedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
