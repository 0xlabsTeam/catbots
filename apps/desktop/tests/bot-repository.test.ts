import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { BotRepository } from '../src/main/bots/bot-repository';
import { openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';

const databases: Database.Database[] = [];

function createDatabase(): Database.Database {
  const db = openDatabase(':memory:');
  databases.push(db);
  migrateDatabase(db);
  return db;
}

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe('BotRepository', () => {
  it('persists a Draft bot with deterministic timestamps', () => {
    const database = createDatabase();
    const bots = new BotRepository(database, () => new Date('2026-09-03T12:00:00.000Z'));

    const created = bots.createDraft({ name: 'BTC Flow', dex: 'hyperliquid' });

    expect(created).toMatchObject({
      name: 'BTC Flow',
      dex: 'hyperliquid',
      status: 'draft',
      createdAt: '2026-09-03T12:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created).not.toHaveProperty('market');
    expect(created).not.toHaveProperty('legacyMarketHint');
    expect(bots.list()).toEqual([created]);
    expect(database.prepare('SELECT dex, legacy_market_hint FROM bots WHERE id = ?').get(created.id)).toEqual({
      dex: 'hyperliquid', legacy_market_hint: '',
    });
  });

  it('returns draft bots in creation order', () => {
    let now = new Date('2026-09-03T12:00:00.000Z');
    const bots = new BotRepository(createDatabase(), () => now);
    const first = bots.createDraft({ name: 'BTC Flow', market: 'BTC-PERP' });
    now = new Date('2026-09-03T12:01:00.000Z');
    const second = bots.createDraft({ name: 'ETH Flow', market: 'ETH-PERP' });

    expect(bots.list()).toEqual([first, second]);
  });

  it('validates stored bot rows through the shared summary schema', () => {
    const db = createDatabase();
    db.prepare(
      'INSERT INTO bots (id, name, dex, legacy_market_hint, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('not-a-uuid', 'BTC Flow', 'hyperliquid', 'BTC-PERP', 'draft', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');

    expect(() => new BotRepository(db).list()).toThrow();
  });
});
