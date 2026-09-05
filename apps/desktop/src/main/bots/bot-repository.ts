import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  BotSummarySchema,
  CreateDraftBotInputSchema,
  type BotSummary,
  type CreateDraftBotInput,
} from '@catbots/contracts';

export type Clock = () => Date;

type LegacyDraftBotInput = Readonly<{ name: string; market: string }>;

type BotRow = {
  id: unknown;
  name: unknown;
  dex: unknown;
  status: unknown;
  created_at: unknown;
  updated_at: unknown;
};

export class BotRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock = () => new Date(),
  ) {}

  createDraft(input: CreateDraftBotInput | LegacyDraftBotInput): BotSummary {
    const parsed = CreateDraftBotInputSchema.safeParse(input);
    const legacy = parsed.success ? undefined : parseLegacyDraft(input);
    const draft = parsed.success ? parsed.data : legacy === undefined
      ? CreateDraftBotInputSchema.parse(input)
      : { name: legacy.name, dex: 'hyperliquid' as const };
    const id = randomUUID();
    const timestamp = this.clock().toISOString();

    this.database.prepare(`
      INSERT INTO bots (id, name, dex, legacy_market_hint, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?)
    `).run(id, draft.name, draft.dex, legacy?.market ?? '', timestamp, timestamp);

    const row = this.database.prepare(`
      SELECT id, name, dex, status, created_at, updated_at
      FROM bots
      WHERE id = ?
    `).get(id);
    if (row === undefined) throw new Error('Created bot could not be loaded');

    return toBotSummary(row);
  }

  list(): BotSummary[] {
    const rows = this.database.prepare(`
      SELECT id, name, dex, status, created_at, updated_at
      FROM bots
      ORDER BY created_at ASC, rowid ASC
    `).all();

    return rows.map(toBotSummary);
  }
}

function parseLegacyDraft(input: unknown): LegacyDraftBotInput | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  if (typeof source.name !== 'string' || typeof source.market !== 'string') return undefined;
  if (source.name.length === 0 || source.name.length > 80 || source.market.length === 0 || source.market.length > 40) return undefined;
  return { name: source.name, market: source.market };
}

function toBotSummary(row: unknown): BotSummary {
  const source = row as BotRow;

  return BotSummarySchema.parse({
    id: source.id,
    name: source.name,
    dex: source.dex,
    status: source.status,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  });
}
