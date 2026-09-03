import Database from 'better-sqlite3';
import { join } from 'node:path';
import { migrateDatabase } from './migrations';

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

  start(dataDirectory: string): Database.Database {
    const database = openDatabase(join(dataDirectory, 'catbots.db'));

    try {
      migrateDatabase(database);
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
