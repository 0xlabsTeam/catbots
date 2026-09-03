import type Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDatabase, openDatabase } from '../src/main/storage/database';
import { migrateDatabase } from '../src/main/storage/migrations';

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

function trackDatabase(db: Database.Database): Database.Database {
  databases.push(db);
  return db;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catbots-database-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  databases.splice(0).forEach((database) => database.close());
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('openDatabase', () => {
  it('enables foreign keys and WAL for file databases', async () => {
    const db = trackDatabase(openDatabase(join(await createTemporaryDirectory(), 'catbots.db')));

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('enables foreign keys without requesting WAL for memory databases', () => {
    const db = trackDatabase(openDatabase(':memory:'));

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
  });
});

describe('migrateDatabase', () => {
  it('records schema version 1 once when called repeatedly', () => {
    const db = trackDatabase(openDatabase(':memory:'));

    migrateDatabase(db);
    migrateDatabase(db);

    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bots'").all()).toEqual([{ name: 'bots' }]);
  });

  it('rolls back an incomplete migration when schema creation fails', () => {
    const db = trackDatabase(openDatabase(':memory:'));
    db.exec('CREATE TABLE bots (id TEXT PRIMARY KEY)');

    expect(() => migrateDatabase(db)).toThrow(/bots/i);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").all()).toEqual([]);
  });
});

describe('ApplicationDatabase', () => {
  it('opens and migrates catbots.db in the user data directory, then closes it', async () => {
    const lifecycle = new ApplicationDatabase();
    const dataDirectory = await createTemporaryDirectory();

    const db = lifecycle.start(dataDirectory);

    expect(db.name).toBe(join(dataDirectory, 'catbots.db'));
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    lifecycle.close();
    expect(db.open).toBe(false);
  });

  it('closes the exact opened database when migration fails', async () => {
    const database = { close: vi.fn() } as unknown as Database.Database;
    const opener = vi.fn(() => database);
    const migrator = vi.fn(() => {
      throw new Error('migration failed');
    });

    const dataDirectory = await createTemporaryDirectory();

    expect(() => new ApplicationDatabase(opener, migrator).start(dataDirectory))
      .toThrow('migration failed');
    expect(opener).toHaveBeenCalledOnce();
    expect(migrator).toHaveBeenCalledWith(database);
    expect(database.close).toHaveBeenCalledOnce();
  });
});
