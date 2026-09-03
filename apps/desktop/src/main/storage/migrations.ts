import type Database from 'better-sqlite3';

const SCHEMA_VERSION = 1;

export function migrateDatabase(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const migration = database.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION);
    if (migration !== undefined) return;

    database.exec(`
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        market TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','paper','live','paused','stopped','error','recovering')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString());
  })();
}
