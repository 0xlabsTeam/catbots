import { describe, expect, it } from 'vitest';

import { formatOrderPrice, formatOrderSize } from '../src/main/execution/hyperliquid/hyperliquid-normalization';

describe('Hyperliquid order normalization', () => {
  it('applies the venue five-significant-figure and perp decimal-place price rules', () => {
    expect(formatOrderPrice(123456.789, 0)).toBe('123450');
    expect(formatOrderPrice(0.01234567, 0)).toBe('0.012345');
    expect(formatOrderPrice(1.23456789, 5)).toBe('1.2');
  });

  it('truncates size to the market lot precision and rejects zero-sized orders', () => {
    expect(formatOrderSize(1.23456789, 5)).toBe('1.23456');
    expect(() => formatOrderSize(0.000001, 5)).toThrowError(expect.objectContaining({ code: 'HYPERLIQUID_SIZE_INVALID' }));
  });
});
