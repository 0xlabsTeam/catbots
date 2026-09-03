import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  BotSummarySchema,
  CreateDraftBotInputSchema,
  type BotSummary,
  type CreateDraftBotInput,
} from '@catbots/contracts';

export type Clock = () => Date;

type BotRow = {
  id: unknown;
  name: unknown;
  market: unknown;
  status: unknown;
  created_at: unknown;
  updated_at: unknown;
};

export class BotRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock = () => new Date(),
  ) {}

  createDraft(input: CreateDraftBotInput): BotSummary {
    const draft = CreateDraftBotInputSchema.parse(input);
    const id = randomUUID();
    const timestamp = this.clock().toISOString();

    this.database.prepare(`
      INSERT INTO bots (id, name, market, status, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, ?)
    `).run(id, draft.name, draft.market, timestamp, timestamp);

    const row = this.database.prepare(`
      SELECT id, name, market, status, created_at, updated_at
      FROM bots
      WHERE id = ?
    `).get(id);
    if (row === undefined) throw new Error('Created bot could not be loaded');

    return toBotSummary(row);
  }

  list(): BotSummary[] {
    const rows = this.database.prepare(`
      SELECT id, name, market, status, created_at, updated_at
      FROM bots
      ORDER BY created_at ASC, rowid ASC
    `).all();

    return rows.map(toBotSummary);
  }
}

function toBotSummary(row: unknown): BotSummary {
  const source = row as BotRow;

  return BotSummarySchema.parse({
    id: source.id,
    name: source.name,
    market: source.market,
    status: source.status,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  });
}
