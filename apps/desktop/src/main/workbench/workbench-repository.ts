import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  BacktestSummarySchema,
  BacktestMetricsSchema,
  TraceSummarySchema,
  BotSummarySchema,
  ChatMessageSchema,
  StrategyRevisionSchema,
  WorkbenchStateSchema,
  type BacktestSummary,
  type BotSummary,
  type ChatMessage,
  type StrategyRevision,
  type WorkbenchState,
} from '@catbots/contracts';
import {
  createBuiltinRegistry,
  parseStrategyDocument,
  serializeStrategyDocument,
  validateStrategy,
  type StrategyDocument,
} from '@catbots/strategy-runtime';

type Clock = () => Date;
type IdFactory = () => string;

type RevisionRow = {
  bot_id: unknown;
  version: unknown;
  strategy_id: unknown;
  name: unknown;
  document_json: unknown;
  status: unknown;
  created_at: unknown;
  approved_at: unknown;
};

export type StoredBotIdentity = Readonly<{
  summary: BotSummary;
  legacyMarketHint: string | null;
}>;

const registry = createBuiltinRegistry();
const LegacyStoredBacktestSchema = BacktestSummarySchema.omit({ datasetCoverage: true, perMarket: true, legacyProjection: true }).extend({
  metrics: BacktestMetricsSchema.omit({ endingEquity: true, realizedPnl: true }),
  traces: z.array(TraceSummarySchema.omit({ parentTraceId: true, market: true, universeRevision: true })),
});

function projectStoredBacktest(source: unknown, legacyMarketHint: string | null): BacktestSummary {
  const current = BacktestSummarySchema.safeParse(source);
  if (current.success) return current.data;
  const legacy = LegacyStoredBacktestSchema.parse(source);
  return BacktestSummarySchema.parse({
    ...legacy, legacyProjection: true, datasetCoverage: null, perMarket: [],
    metrics: { ...legacy.metrics, endingEquity: legacy.equityCurve.at(-1)?.equity ?? null, realizedPnl: null },
    traces: legacy.traces.map((trace) => ({ ...trace, parentTraceId: null, market: legacyMarketHint })),
    warnings: [...legacy.warnings, 'Legacy Backtest: dataset coverage, per-market attribution, and realized PnL were not recorded.'],
  });
}

export class WorkbenchRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly clock: Clock = () => new Date(),
    private readonly idFactory: IdFactory = randomUUID,
  ) {}

  createValidatedRevision(botId: string, candidate: StrategyDocument): StrategyRevision {
    return this.database.transaction(() => {
      this.requireBot(botId);
      const next = this.database.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM strategy_revisions WHERE bot_id = ?
      `).get(botId) as { version: number };
      const document = parseStrategyDocument({
        ...candidate,
        strategy: { ...candidate.strategy, version: next.version },
      });
      const validation = validateStrategy(document, registry);
      if (!validation.valid) {
        throw new Error(`Invalid strategy: ${validation.errors.map((error) => error.message).join('; ')}`);
      }

      const serialized = serializeStrategyDocument(document);
      this.database.prepare(`
        INSERT INTO strategy_revisions (
          bot_id, version, strategy_id, name, document_json, document_hash, status, created_at, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NULL)
      `).run(
        botId,
        next.version,
        document.strategy.id,
        document.strategy.name,
        serialized,
        sha256(serialized),
        this.clock().toISOString(),
      );
      return this.getRevision(botId, next.version);
    }).immediate();
  }

  approveRevision(botId: string, version: number): StrategyRevision {
    const result = this.database.prepare(`
      UPDATE strategy_revisions SET status = 'approved', approved_at = ?
      WHERE bot_id = ? AND version = ?
    `).run(this.clock().toISOString(), botId, version);
    if (result.changes !== 1) throw new Error('Strategy revision not found');
    return this.getRevision(botId, version);
  }

  appendChatMessage(botId: string, role: ChatMessage['role'], content: string): ChatMessage {
    this.requireBot(botId);
    const message = ChatMessageSchema.parse({
      id: this.idFactory(),
      botId,
      role,
      content,
      createdAt: this.clock().toISOString(),
    });
    this.database.prepare(`
      INSERT INTO chat_messages (id, bot_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(message.id, message.botId, message.role, message.content, message.createdAt);
    return message;
  }

  createBacktestRun(input: BacktestSummary, artifactJson: string): BacktestSummary {
    const summary = BacktestSummarySchema.parse(input);
    if (sha256(artifactJson) !== summary.artifactHash) {
      throw new Error('Backtest artifact hash does not match its content');
    }
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT OR IGNORE INTO backtest_traces (artifact_hash, artifact_json, created_at)
        VALUES (?, ?, ?)
      `).run(summary.artifactHash, artifactJson, this.clock().toISOString());
      this.database.prepare(`
        INSERT INTO backtest_runs (
          id, bot_id, revision_version, status, data_source, started_at, completed_at, summary_json, artifact_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        summary.id,
        summary.botId,
        summary.revisionVersion,
        summary.status,
        summary.dataSource,
        summary.startedAt,
        summary.completedAt,
        JSON.stringify(summary),
        summary.artifactHash,
      );
    })();
    return summary;
  }

  getStrategyDocument(botId: string, version: number): StrategyDocument {
    const row = this.database.prepare(`
      SELECT document_json FROM strategy_revisions WHERE bot_id = ? AND version = ?
    `).get(botId, version) as { document_json: unknown } | undefined;
    if (row === undefined || typeof row.document_json !== 'string') throw new Error('Strategy revision not found');
    return parseStrategyDocument(JSON.parse(row.document_json));
  }

  getTraceArtifact(botId: string, artifactHash: string): string {
    const row = this.database.prepare(`
      SELECT traces.artifact_json
      FROM backtest_traces AS traces
      INNER JOIN backtest_runs AS runs ON runs.artifact_hash = traces.artifact_hash
      WHERE runs.bot_id = ? AND traces.artifact_hash = ? LIMIT 1
    `).get(botId, artifactHash) as { artifact_json: unknown } | undefined;
    if (row === undefined || typeof row.artifact_json !== 'string') throw new Error('Backtest trace artifact not found');
    return row.artifact_json;
  }

  getState(botId: string, selectedVersion?: number): WorkbenchState {
    const identity = this.getStoredIdentity(botId);
    const bot = identity.summary;
    const revisions = this.database.prepare(`
      SELECT bot_id, version, strategy_id, name, document_json, status, created_at, approved_at
      FROM strategy_revisions WHERE bot_id = ? ORDER BY version DESC
    `).all(botId).map((row) => toStrategyRevision(row, identity.legacyMarketHint));
    const messages = this.database.prepare(`
      SELECT id, bot_id, role, content, created_at
      FROM chat_messages WHERE bot_id = ? ORDER BY created_at ASC, rowid ASC
    `).all(botId).map((row) => {
      const source = row as Record<string, unknown>;
      return ChatMessageSchema.parse({
        id: source.id,
        botId: source.bot_id,
        role: source.role,
        content: source.content,
        createdAt: source.created_at,
      });
    });
    const backtests = this.database.prepare(`
      SELECT summary_json FROM backtest_runs
      WHERE bot_id = ? ORDER BY started_at DESC, rowid DESC
    `).all(botId).map((row) => {
      const serialized = (row as { summary_json: unknown }).summary_json;
      if (typeof serialized !== 'string') throw new Error('Stored backtest summary is invalid');
      return projectStoredBacktest(JSON.parse(serialized), identity.legacyMarketHint);
    });

    return WorkbenchStateSchema.parse({
      bot,
      currentRevision: selectedVersion === undefined
        ? revisions[0] ?? null
        : revisions.find(({ version }) => version === selectedVersion) ?? (() => { throw new Error('Strategy revision not found'); })(),
      revisions: revisions.map(({ version, status, createdAt, approvedAt }) => ({ version, status, createdAt, approvedAt })),
      messages,
      backtests,
    });
  }

  getStoredIdentity(botId: string): StoredBotIdentity {
    const row = this.database.prepare(`
      SELECT id, name, dex, legacy_market_hint, status, created_at, updated_at
      FROM bots WHERE id = ?
    `).get(botId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Bot not found');
    return {
      summary: BotSummarySchema.parse({
        id: row.id,
        name: row.name,
        dex: row.dex,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      legacyMarketHint: typeof row.legacy_market_hint === 'string' && row.legacy_market_hint.length > 0
        ? row.legacy_market_hint
        : null,
    };
  }

  private getRevision(botId: string, version: number): StrategyRevision {
    const row = this.database.prepare(`
      SELECT bot_id, version, strategy_id, name, document_json, status, created_at, approved_at
      FROM strategy_revisions WHERE bot_id = ? AND version = ?
    `).get(botId, version);
    if (row === undefined) throw new Error('Strategy revision not found');
    return toStrategyRevision(row, this.getStoredIdentity(botId).legacyMarketHint);
  }

  private requireBot(botId: string) {
    const row = this.database.prepare(`
      SELECT id, name, dex, status, created_at, updated_at FROM bots WHERE id = ?
    `).get(botId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Bot not found');
    return BotSummarySchema.parse({
      id: row.id,
      name: row.name,
      dex: row.dex,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

function toStrategyRevision(row: unknown, legacyMarketHint: string | null): StrategyRevision {
  const source = row as RevisionRow;
  if (typeof source.document_json !== 'string') throw new Error('Stored strategy document is invalid');
  const document = parseStrategyDocument(JSON.parse(source.document_json));
  return StrategyRevisionSchema.parse({
    botId: source.bot_id,
    strategyId: source.strategy_id,
    version: source.version,
    name: source.name,
    schemaVersion: document.schemaVersion,
    marketScope: document.schemaVersion === '2.0'
      ? { type: 'dex_universe' }
      : { type: 'legacy_fixed', ...(legacyMarketHint === null ? {} : { market: legacyMarketHint }) },
    status: source.status,
    createdAt: source.created_at,
    approvedAt: source.approved_at,
    nodes: document.nodes.map((node) => {
      const definition = registry.get(node.kind, node.type, node.version);
      return {
        id: node.id,
        kind: node.kind,
        type: node.type,
        version: node.version,
        title: definition.visualization.title,
        summary: definition.visualization.summary(node.config),
      };
    }),
    edges: document.edges,
  });
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
