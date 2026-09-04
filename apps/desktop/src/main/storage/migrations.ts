import type Database from 'better-sqlite3';

type Migration = Readonly<{ version: number; sql: string }>;

const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        market TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','paper','live','paused','stopped','error','recovering')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE strategy_revisions (
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version > 0),
        strategy_id TEXT NOT NULL,
        name TEXT NOT NULL,
        document_json TEXT NOT NULL,
        document_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
        created_at TEXT NOT NULL,
        approved_at TEXT,
        PRIMARY KEY (bot_id, version),
        UNIQUE (bot_id, document_hash)
      );

      CREATE TRIGGER strategy_revisions_document_is_immutable
      BEFORE UPDATE OF bot_id, version, strategy_id, name, document_json, document_hash, created_at
      ON strategy_revisions
      BEGIN
        SELECT RAISE(ABORT, 'strategy revision document is immutable');
      END;

      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX chat_messages_by_bot ON chat_messages (bot_id, created_at);

      CREATE TABLE backtest_traces (
        artifact_hash TEXT PRIMARY KEY,
        artifact_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE backtest_runs (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        revision_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed')),
        data_source TEXT NOT NULL CHECK (data_source = 'Bundled sample data'),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        summary_json TEXT NOT NULL,
        artifact_hash TEXT NOT NULL REFERENCES backtest_traces(artifact_hash),
        FOREIGN KEY (bot_id, revision_version) REFERENCES strategy_revisions(bot_id, version) ON DELETE CASCADE
      );

      CREATE INDEX strategy_revisions_by_bot ON strategy_revisions (bot_id, version DESC);
      CREATE INDEX backtest_runs_by_bot ON backtest_runs (bot_id, started_at DESC);
    `,
  },
];

export function migrateDatabase(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const hasMigration = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    const recordMigration = database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
    for (const migration of migrations) {
      if (hasMigration.get(migration.version) !== undefined) continue;
      database.exec(migration.sql);
      recordMigration.run(migration.version, new Date().toISOString());
    }
  })();
}
