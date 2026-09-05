import { describe, expect, it } from 'vitest';

import { BotSummarySchema, CreateDraftBotInputSchema } from './bots';

const botFixture = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ETH RSI',
  dex: 'hyperliquid',
  status: 'draft',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

describe('bot contracts', () => {
  it('creates a DEX-scoped draft without a market', () => {
    expect(CreateDraftBotInputSchema.parse({ name: 'ETH RSI', dex: 'hyperliquid' })).toEqual({
      name: 'ETH RSI', dex: 'hyperliquid',
    });
    expect(CreateDraftBotInputSchema.safeParse({
      name: 'ETH RSI', dex: 'hyperliquid', market: 'ETH-PERP',
    }).success).toBe(false);
  });

  it('exposes public Bot summaries without a market', () => {
    expect(BotSummarySchema.parse(botFixture)).not.toHaveProperty('market');
  });
});
