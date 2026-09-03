import Database from 'better-sqlite3';
import { join } from 'node:path';
import { migrateDatabase } from './migrations';

export type DatabaseOpener = (path: string) => Database.Database;
export type DatabaseMigrator = (database: Database.Database) => void;

export function openDatabase(path: string): Database.Database {
  const database = new Database(path);

  try {
    database.pragma('foreign_keys = ON');
    if (path !== ':memory:') database.pragma('journal_mode = WAL');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export class ApplicationDatabase {
  private database: Database.Database | undefined;

  constructor(
    private readonly open: DatabaseOpener = openDatabase,
    private readonly migrate: DatabaseMigrator = migrateDatabase,
  ) {}

  start(dataDirectory: string): Database.Database {
    const database = this.open(join(dataDirectory, 'catbots.db'));

    try {
      this.migrate(database);
      this.database = database;
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }
}
