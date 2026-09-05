# DEX-Scoped Dynamic Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Catbots' fixed-market Bot model with one-Bot-one-DEX dynamic-market evaluation, Backtest, Paper, and Hyperliquid testnet execution while preserving legacy Strategy and deployment behavior.

**Architecture:** Introduce versioned Bot, Strategy, deployment, and Backtest contracts first so every existing caller remains readable. Keep `@catbots/strategy-runtime` deterministic: a new coordinator fans one trigger run into immutable per-market evaluation contexts, while DEX/data adapters provide point-in-time market universes. Persist DEX identity, legacy market hints, universe revisions, parent/child traces, and versioned deployment scope in Electron Main. Bind every action to `currentMarket` before risk evaluation, then surface aggregate/per-market results and DEX-wide scope in the Kumo/React Flow UI.

**Tech Stack:** TypeScript, Zod, Vitest, better-sqlite3, Electron, React 19, Cloudflare Kumo, React Flow (`@xyflow/react`), Playwright, Hyperliquid adapter.

**Spec:** `docs/superpowers/specs/2026-09-05-dex-scoped-dynamic-markets-design.md`

## Global Constraints

- New Bots contain `dex: 'hyperliquid'` and expose no `market` field; one Bot never spans multiple DEXs.
- Strategy schema `1.0` and existing deployments retain fixed-market semantics until an explicitly approved new revision or stop.
- New Strategy revisions use schema `2.0` with `marketScope: { type: 'dex_universe' }`.
- Interval triggers fan out across the point-in-time eligible universe; market Events evaluate only the Event market.
- Conditions may select a symbol; Actions never accept or override a symbol and always inherit `currentMarket`.
- The runtime remains deterministic and performs no network access. Market-universe refresh belongs to adapters/coordinators.
- One Backtest or deployment owns one shared portfolio, risk state, and order-rate budget across all markets.
- Missing/stale market data yields `unknown`; stale/unavailable universe metadata blocks position increases.
- Inactive markets reject increases but permit a provably reducing close.
- Every trigger parent, market child, Condition result, Action proposal, risk decision, outbox transition, adapter result, fill, and terminal outcome is logged without secrets.
- New database migrations are transactional and lossless. Existing Strategy, Backtest, deployment, outbox, and audit records remain readable.
- Keep Electron Main as the trust boundary; renderer DTOs and Agent context never receive credentials.
- Before execution, preserve or separately commit the currently modified startup/onboarding files; do not fold unrelated working-tree changes into feature commits.

---

### Task 1: Add versioned DEX-scoped public contracts

**Files:**
- Modify: `packages/contracts/src/bots.ts`
- Modify: `packages/contracts/src/workbench.ts`
- Modify: `packages/contracts/src/execution.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/workbench.test.ts`
- Test: `packages/contracts/src/execution.test.ts`
- Create: `packages/contracts/src/bots.test.ts`

**Interfaces:**
- Produces `DexId`, a public `BotSummary` without `market`, versioned deployment scope, Backtest universe selection, per-market metrics, and market-aware trace DTOs.
- Temporarily accepts both legacy and dynamic deployment records so later storage tasks can migrate without breaking reads.

- [ ] **Step 1: Write failing Bot contract tests**

```ts
expect(CreateDraftBotInputSchema.parse({ name: 'ETH RSI', dex: 'hyperliquid' })).toEqual({
  name: 'ETH RSI', dex: 'hyperliquid',
});
expect(CreateDraftBotInputSchema.safeParse({ name: 'ETH RSI', dex: 'hyperliquid', market: 'ETH-PERP' }).success).toBe(false);
expect(BotSummarySchema.parse(botFixture)).not.toHaveProperty('market');
```

- [ ] **Step 2: Write failing deployment and Backtest contract tests**

```ts
expect(DynamicDeploymentSchema.parse(dynamicDeployment)).toMatchObject({
  dex: 'hyperliquid',
  executionVenue: 'paper',
  marketAccess: { mode: 'all_active_perpetuals' },
});
expect(BacktestMarketUniverseSchema.parse({ mode: 'include', markets: ['ETH-PERP'] })).toEqual({
  mode: 'include', markets: ['ETH-PERP'],
});
expect(BacktestSummarySchema.parse(summary).perMarket[0]?.market).toBe('ETH-PERP');
expect(TraceSummarySchema.parse(trace)).toMatchObject({ parentTraceId: 'run:1', market: 'ETH-PERP' });
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `pnpm --filter @catbots/contracts exec vitest run src/bots.test.ts src/workbench.test.ts src/execution.test.ts`

Expected: FAIL because DEX, dynamic scope, per-market results, and trace linkage are absent.

- [ ] **Step 4: Implement strict versioned contracts**

```ts
export const DexIdSchema = z.enum(['hyperliquid']);
export const CreateDraftBotInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  dex: DexIdSchema,
}).strict();

export const BacktestMarketUniverseSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all_available') }).strict(),
  z.object({ mode: z.literal('include'), markets: UniqueMarketsSchema }).strict(),
]);

export const MarketAccessSchema = z.object({ mode: z.literal('all_active_perpetuals') }).strict();

export const DatabaseStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }).strict(),
  z.object({ status: z.literal('repair'), code: z.literal('DATABASE_MIGRATION_FAILED') }).strict(),
]);
```

Define `LegacyRiskLimitsSchema` with the current `allowedMarkets` field and `DynamicRiskLimitsSchema` with `maxTotalExposureUsd` while retaining order, per-market position, direction, leverage, loss, drawdown, and rate limits. `LegacyDeploymentSchema` contains `recordVersion: 1`, `marketBindings`, and legacy limits. `DynamicDeploymentSchema` contains `recordVersion: 2`, `dex`, `executionVenue`, `marketAccess`, and dynamic limits. Export `DeploymentSchema` as their union and export `RiskLimits` as the new dynamic type used by new start requests. Extend `RunWorkbenchBacktestInputSchema` with `marketUniverse`; add `endingEquity` and `realizedPnl` to aggregate Backtest metrics; extend summaries with `datasetCoverage`, `perMarket`, `parentTraceId`, and `market`; expose `runtime.getDatabaseState()` over IPC; and add `universe.resolved`, `market.evaluation_started`, and `market.evaluation_completed` to the audit event enum.

- [ ] **Step 5: Run contract tests and typecheck**

Run: `pnpm --filter @catbots/contracts test && pnpm --filter @catbots/contracts typecheck`

Expected: PASS with excess `market` fields rejected and both deployment record versions parsed.

- [ ] **Step 6: Commit**

```sh
git add packages/contracts
git commit -m "feat: define dex scoped dynamic market contracts"
```

### Task 2: Migrate Bot and deployment storage without changing legacy semantics

**Files:**
- Modify: `apps/desktop/src/main/storage/migrations.ts`
- Modify: `apps/desktop/src/main/bots/bot-repository.ts`
- Modify: `apps/desktop/src/main/workbench/workbench-repository.ts`
- Modify: `apps/desktop/src/main/execution/execution-repository.ts`
- Modify: `apps/desktop/src/main/storage/database.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/screens/DatabaseRepairScreen.tsx`
- Test: `apps/desktop/tests/database.test.ts`
- Test: `apps/desktop/tests/bot-repository.test.ts`
- Test: `apps/desktop/tests/workbench-repository.test.ts`
- Test: `apps/desktop/tests/execution-repository.test.ts`
- Test: `apps/desktop/tests/main-lifecycle.test.ts`

**Interfaces:**
- Migration 4 adds Bot DEX identity and a private legacy market hint, and versions deployment scope while preserving immutable old rows.
- Repository output conforms to Task 1; only internal compatibility reads may access `legacyMarketHint`.

- [ ] **Step 1: Write a failing migration fixture test**

```ts
const before = seedVersion3Database({ botMarket: 'BTC-PERP', deploymentMarketBindings: ['BTC-PERP'] });
migrateDatabase(before);
expect(before.prepare('SELECT dex, legacy_market_hint FROM bots').get()).toEqual({
  dex: 'hyperliquid', legacy_market_hint: 'BTC-PERP',
});
expect(repository.getDeployment(legacyDeploymentId)).toMatchObject({ marketBindings: ['BTC-PERP'] });
expect(() => repository.stopLegacyDeployment(legacyDeploymentId, stoppedAt)).not.toThrow();
```

- [ ] **Step 2: Write failing repository tests for new Bots and deployments**

```ts
const bot = bots.createDraft({ name: 'Universe bot', dex: 'hyperliquid' });
expect(bot).toMatchObject({ name: 'Universe bot', dex: 'hyperliquid' });
expect(bot).not.toHaveProperty('market');
expect(execution.createDeployment(dynamicDeployment)).toMatchObject({
  recordVersion: 2, marketAccess: { mode: 'all_active_perpetuals' },
});
```

- [ ] **Step 3: Run storage tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/bot-repository.test.ts tests/workbench-repository.test.ts tests/execution-repository.test.ts`

Expected: FAIL because schema version 4 and DEX repository mappings do not exist.

- [ ] **Step 4: Add transactional migration 4**

Rename the legacy column in place so SQLite retains every existing foreign key to the `bots` table. Keep an empty string as the internal no-hint sentinel for newly created Bots; repositories convert it to `null` and never expose it publicly:

```sql
ALTER TABLE bots RENAME COLUMN market TO legacy_market_hint;
ALTER TABLE bots ADD COLUMN dex TEXT NOT NULL DEFAULT 'hyperliquid'
  CHECK (dex IN ('hyperliquid'));
```

Run `PRAGMA foreign_key_check` before recording the migration. Add nullable `record_version`, `dex`, `execution_venue`, and `market_access_json` columns to deployments; the repository maps `NULL` record versions to version 1 with immutable `market_bindings_json`, while new rows explicitly write version 2 dynamic fields. Do not rewrite old deployment JSON.

- [ ] **Step 5: Update repositories with explicit legacy accessors**

```ts
type StoredBotIdentity = Readonly<{
  summary: BotSummary;
  legacyMarketHint: string | null;
}>;

getStoredIdentity(botId: string): StoredBotIdentity;
```

Only compatibility execution and schema-1.0 evaluation may call `getStoredIdentity`; `list()` and workbench state return the public `BotSummary`.

- [ ] **Step 6: Route migration failures to a safe repair state**

```ts
export type DatabaseOpenResult =
  | Readonly<{ status: 'ready'; database: Database.Database }>
  | Readonly<{ status: 'repair'; code: 'DATABASE_MIGRATION_FAILED' }>;
```

Keep the failed database closed, launch the normal trusted window without Bot/deployment services, and expose only the fixed repair status through IPC. `DatabaseRepairScreen` explains that local records were left unchanged and offers Quit; it does not expose raw SQL, paths, or error messages. A lifecycle test forces migration failure and asserts that the renderer reaches repair mode rather than `Catbots fatal startup error`.

- [ ] **Step 7: Run storage tests and typecheck**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/bot-repository.test.ts tests/workbench-repository.test.ts tests/execution-repository.test.ts tests/main-lifecycle.test.ts && pnpm --filter @catbots/desktop typecheck`

Expected: PASS; a forced migration error rolls the schema back to version 3 with all original rows and foreign keys intact.

- [ ] **Step 8: Commit**

```sh
git add apps/desktop/src/main/storage apps/desktop/src/main/main.ts apps/desktop/src/main/bots apps/desktop/src/main/workbench/workbench-repository.ts apps/desktop/src/main/execution/execution-repository.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/screens/DatabaseRepairScreen.tsx apps/desktop/tests
git commit -m "feat: migrate bots to dex identity"
```

### Task 3: Add Strategy 2.0 and immutable current-market context

**Files:**
- Modify: `packages/strategy-runtime/src/strategy-schema.ts`
- Modify: `packages/strategy-runtime/src/evaluation-context.ts`
- Modify: `packages/strategy-runtime/src/builtins.ts`
- Modify: `packages/strategy-runtime/src/condition-evaluator.ts`
- Modify: `packages/strategy-runtime/src/runtime.ts`
- Modify: `packages/strategy-runtime/src/index.ts`
- Test: `packages/strategy-runtime/src/strategy-schema.test.ts`
- Test: `packages/strategy-runtime/src/condition-evaluator.test.ts`
- Test: `packages/strategy-runtime/src/runtime.test.ts`

**Interfaces:**
- Parses both Strategy `1.0` and `2.0`; only `2.0` declares dynamic DEX scope.
- Adds `currentMarket` to each evaluation and stamps it onto every proposed effect.

- [ ] **Step 1: Write failing Strategy 2.0 and context tests**

```ts
expect(parseStrategyDocument({ ...strategy, schemaVersion: '2.0', marketScope: { type: 'dex_universe' } })).toMatchObject({
  schemaVersion: '2.0', marketScope: { type: 'dex_universe' },
});
expect(() => parseStrategyDocument({ ...strategy, schemaVersion: '2.0' })).toThrow();
const context = createEvaluationContext({ evaluatedAt, currentMarket: 'ETH-PERP', values });
expect(context.currentMarket).toBe('ETH-PERP');
expect(context.values['market.symbol']?.value).toBe('ETH-PERP');
```

- [ ] **Step 2: Write failing Action-binding and symbol-condition tests**

```ts
expect(evaluateTrigger(requestFor('ETH-PERP')).effects[0]).toMatchObject({ market: 'ETH-PERP' });
expect(evaluateTrigger(requestFor('BTC-PERP')).effects).toHaveLength(0);
expect(() => evaluateTrigger(requestWithActionConfig({ market: 'BTC-PERP' }))).toThrow();
```

- [ ] **Step 3: Run runtime tests and confirm RED**

Run: `pnpm --filter @catbots/strategy-runtime exec vitest run src/strategy-schema.test.ts src/condition-evaluator.test.ts src/runtime.test.ts`

Expected: FAIL because only schema 1.0 and market-less effects exist.

- [ ] **Step 4: Implement the versioned Strategy union and context binding**

```ts
const StrategyV1DocumentSchema = StrategyBaseSchema.extend({ schemaVersion: z.literal('1.0') }).strict();
const StrategyV2DocumentSchema = StrategyBaseSchema.extend({
  schemaVersion: z.literal('2.0'),
  marketScope: z.object({ type: z.literal('dex_universe') }).strict(),
}).strict();
export const StrategyDocumentSchema = z.union([StrategyV1DocumentSchema, StrategyV2DocumentSchema]);

export type EvaluationContext = Readonly<{
  evaluatedAt: string;
  currentMarket: string;
  triggerEvent?: TriggerEvent;
  values: Readonly<Record<string, EvaluationValue>>;
}>;

export type TriggerEvent = Readonly<{
  id: string;
  type: string;
  market?: string;
  occurredAt: string;
  receivedAt: string;
  source: string;
  payload: Readonly<Record<string, JsonValue>>;
  quality: Readonly<{ status: DataQualityStatus; freshnessSeconds: number }>;
}>;

export type ProposedEffect = Readonly<{
  nodeId: string;
  type: string;
  version: number;
  market: string;
  config: Readonly<Record<string, JsonValue>>;
  idempotencyKey: string;
}>;
```

`createEvaluationContext` injects a verified `market.symbol` value derived from `currentMarket`; reject conflicting caller values. Remove the optional `market` from `predicate.position_state`; it reads positions for `currentMarket`. Include the bound market in effect idempotency. Extend `trigger.event` config with `scope: 'market' | 'dex'` defaulting to `market`; market-scoped Events require `TriggerEvent.market`, while DEX-scoped Events may use the coordinator universe.

- [ ] **Step 5: Run all strategy-runtime tests**

Run: `pnpm --filter @catbots/strategy-runtime test && pnpm --filter @catbots/strategy-runtime typecheck`

Expected: PASS for schema 1.0 compatibility, schema 2.0 strictness, combined Conditions, and current-market binding.

- [ ] **Step 6: Commit**

```sh
git add packages/strategy-runtime
git commit -m "feat: bind strategy v2 evaluations to current market"
```

### Task 4: Fan trigger runs out through a deterministic market coordinator

**Files:**
- Create: `packages/strategy-runtime/src/market-universe.ts`
- Create: `packages/strategy-runtime/src/evaluation-coordinator.ts`
- Modify: `packages/strategy-runtime/src/audit-trace.ts`
- Modify: `packages/strategy-runtime/src/index.ts`
- Test: `packages/strategy-runtime/src/evaluation-coordinator.test.ts`
- Test: `packages/strategy-runtime/src/runtime.test.ts`

**Interfaces:**
- Consumes a point-in-time `MarketUniverseSnapshot` and a pure context factory.
- Produces one parent result and ordered child `RuntimeEvaluation`s with stable trace linkage.

- [ ] **Step 1: Write failing interval fan-out tests**

```ts
const result = coordinateEvaluation({
  ...fixture,
  universe: snapshot('universe:42', ['BTC-PERP', 'ETH-PERP']),
  triggerInput: { kind: 'interval', occurredAt },
});
expect(result.children.map((child) => child.market)).toEqual(['BTC-PERP', 'ETH-PERP']);
expect(result.children.every((child) => child.parentTraceId === result.parentTraceId)).toBe(true);
expect(result.parentTrace.map(({ type }) => type)).toEqual([
  'trigger.received', 'universe.resolved', 'market.evaluation_completed',
  'market.evaluation_completed', 'flow.completed',
]);
```

- [ ] **Step 2: Write failing Event and failure-isolation tests**

```ts
expect(coordinateEvaluation(eventRequest('ETH-PERP')).children.map(({ market }) => market)).toEqual(['ETH-PERP']);
expect(coordinateEvaluation(eventRequest('DOGE-PERP', inactiveUniverse)).children).toHaveLength(0);
expect(coordinateEvaluation(oneContextFails).children.map(({ outcome }) => outcome)).toEqual(['completed', 'failed']);
```

- [ ] **Step 3: Run focused coordinator tests and confirm RED**

Run: `pnpm --filter @catbots/strategy-runtime exec vitest run src/evaluation-coordinator.test.ts src/runtime.test.ts`

Expected: FAIL because no market coordinator or parent trace exists.

- [ ] **Step 4: Implement deterministic fan-out**

```ts
export type MarketUniverseSnapshot = Readonly<{
  dex: 'hyperliquid';
  revision: string;
  observedAt: string;
  markets: readonly Readonly<{
    symbol: string;
    active: boolean;
    sizeDecimals: number;
    maximumLeverage: number;
  }>[];
}>;

export type CoordinatedEvaluation = Readonly<{
  parentTraceId: string;
  parentTrace: readonly AuditEvent[];
  children: readonly Readonly<{
    market: string;
    parentTraceId: string;
    outcome: 'completed' | 'skipped' | 'failed';
    evaluation: RuntimeEvaluation;
  }>[];
}>;
```

Sort markets by normalized symbol before fan-out. Interval excludes inactive markets. A market-scoped Event must provide `event.market`; DEX-wide Event fan-out occurs only when its `trigger.event` config sets `scope: 'dex'`. Build each context independently so one missing market snapshot becomes a failed child, not a mismatched evaluation.

- [ ] **Step 5: Run coordinator and runtime suites**

Run: `pnpm --filter @catbots/strategy-runtime test && pnpm --filter @catbots/strategy-runtime typecheck`

Expected: PASS with stable ordering, stable IDs, one-market Events, and isolated context failures.

- [ ] **Step 6: Commit**

```sh
git add packages/strategy-runtime
git commit -m "feat: coordinate trigger evaluation across markets"
```

### Task 5: Upgrade Backtest to point-in-time universes and one shared portfolio

**Files:**
- Modify: `packages/strategy-runtime/src/backtest-types.ts`
- Modify: `packages/strategy-runtime/src/simulated-adapter.ts`
- Modify: `packages/strategy-runtime/src/backtest.ts`
- Modify: `packages/strategy-runtime/src/metrics.ts`
- Test: `packages/strategy-runtime/src/simulated-adapter.test.ts`
- Test: `packages/strategy-runtime/src/backtest.test.ts`
- Test: `packages/strategy-runtime/src/metrics.test.ts`

**Interfaces:**
- Backtest inputs carry point-in-time universe revisions and market-keyed values.
- One `SimulatedExecutionAdapter` manages cash and positions for every market and returns aggregate plus per-market metrics.

- [ ] **Step 1: Write failing point-in-time membership tests**

```ts
const result = runBacktest(twoMarketFixture({
  firstUniverse: ['BTC-PERP'],
  secondUniverse: ['BTC-PERP', 'ETH-PERP'],
}));
expect(marketsEvaluatedAt(result, firstTimestamp)).toEqual(['BTC-PERP']);
expect(marketsEvaluatedAt(result, secondTimestamp)).toEqual(['BTC-PERP', 'ETH-PERP']);
expect(result.datasetCoverage.markets).toEqual(['BTC-PERP', 'ETH-PERP']);
```

- [ ] **Step 2: Write failing shared-portfolio and per-market metric tests**

```ts
expect(result.snapshot.positions.map(({ market }) => market).sort()).toEqual(['BTC-PERP', 'ETH-PERP']);
expect(result.metrics.endingEquity).toBe(result.equityCurve.at(-1)?.equity);
expect(sumDecimal(result.perMarket.map(({ realizedPnl }) => realizedPnl))).toBe(result.metrics.realizedPnl);
expect(result.perMarket.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
```

- [ ] **Step 3: Run Backtest tests and confirm RED**

Run: `pnpm --filter @catbots/strategy-runtime exec vitest run src/simulated-adapter.test.ts src/backtest.test.ts src/metrics.test.ts`

Expected: FAIL because Backtest accepts one market and the adapter stores one last mark.

- [ ] **Step 4: Make the simulator market-aware**

```ts
export type BacktestFrame = TimedSimulationInput & Readonly<{
  universe: MarketUniverseSnapshot;
  marketValues: Readonly<Record<string, Readonly<Record<string, EvaluationValue<unknown>>>>>;
  fundingRates?: Readonly<Record<string, number>>;
}>;

export class SimulatedExecutionAdapter implements RuntimeExecutionPort {
  readonly #lastMarks = new Map<string, number>();
  readonly #positions: NumericPosition[] = [];
  // execute uses effect.market; cash, fees, funding, and order budget remain shared.
}
```

Use `BacktestMarketUniverse` only to filter the dataset universe. Reject an included market absent from dataset coverage. Pass each frame through `coordinateEvaluation`; never consult today's live adapter universe.

- [ ] **Step 5: Calculate aggregate and per-market outputs**

```ts
export type PerMarketBacktestMetrics = Readonly<{
  market: string;
  realizedPnl: string;
  tradeCount: number;
  winRatePercent: number;
  drawdownContributionPercent: number;
}>;
```

Reconcile per-market realized PnL to the aggregate ledger, while aggregate ending equity additionally reflects shared cash, open-position marks, fees, and funding. Emit explicit `missing_market_coverage` and `stale_data:<market>` warnings.

- [ ] **Step 6: Run the full runtime suite**

Run: `pnpm --filter @catbots/strategy-runtime test && pnpm --filter @catbots/strategy-runtime typecheck`

Expected: PASS for listing changes, deterministic artifacts, shared capital, liquidation, funding, and metric reconciliation.

- [ ] **Step 7: Commit**

```sh
git add packages/strategy-runtime
git commit -m "feat: backtest dynamic market universes"
```

### Task 6: Normalize and cache Hyperliquid market-universe metadata

**Files:**
- Modify: `packages/execution-core/src/adapter.ts`
- Modify: `packages/execution-core/src/index.ts`
- Create: `apps/desktop/src/main/execution/market-universe-cache.ts`
- Modify: `apps/desktop/src/main/execution/hyperliquid/hyperliquid-adapter.ts`
- Modify: `apps/desktop/src/main/execution/hyperliquid/hyperliquid-client.ts`
- Test: `apps/desktop/tests/hyperliquid-adapter.test.ts`
- Create: `apps/desktop/tests/market-universe-cache.test.ts`

**Interfaces:**
- `PerpMarket` gains `active` and precision metadata.
- Cache exposes startup/preflight refresh, periodic refresh, freshness state, and immutable revisions.

- [ ] **Step 1: Write failing normalization and refresh tests**

```ts
expect(await adapter.getMarkets(signal)).toContainEqual({
  market: 'ETH-PERP', baseAsset: 'ETH', quoteAsset: 'USDC',
  active: true, sizeDecimals: 4, maximumLeverage: 50,
});
await cache.refresh(signal);
expect(cache.snapshot().revision).toMatch(/^sha256:/);
expect(cache.snapshot().markets).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: 'ETH-PERP' })]));
```

- [ ] **Step 2: Write failing listing, delisting, and staleness tests**

```ts
expect(afterRefresh.markets.map(({ symbol }) => symbol)).toContain('NEW-PERP');
expect(afterDelist.markets.find(({ symbol }) => symbol === 'OLD-PERP')?.active).toBe(false);
expect(cache.freshness(nowAfterTtl)).toEqual({ fresh: false, reason: 'expired' });
expect(cache.snapshot()).toEqual(lastSuccessfulSnapshot);
```

- [ ] **Step 3: Run adapter/cache tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/hyperliquid-adapter.test.ts tests/market-universe-cache.test.ts`

Expected: FAIL because the adapter omits active/precision state and no cache exists.

- [ ] **Step 4: Implement immutable revisioned snapshots**

```ts
export type PerpMarket = Readonly<{
  market: string;
  baseAsset: string;
  quoteAsset: string;
  active: boolean;
  sizeDecimals: number;
  maximumLeverage: number;
}>;
```

Hash canonical normalized metadata for `revision`; preserve the last successful snapshot on refresh error but mark it stale after the bounded TTL. Refresh on cache initialization, before deployment, and from a cancellable timer owned by the deployment coordinator.

- [ ] **Step 5: Run execution and Hyperliquid suites**

Run: `pnpm --filter @catbots/execution-core test && pnpm --filter @catbots/desktop exec vitest run tests/hyperliquid-client.test.ts tests/hyperliquid-adapter.test.ts tests/market-universe-cache.test.ts`

Expected: PASS with deterministic revisions and no network calls in strategy-runtime.

- [ ] **Step 6: Commit**

```sh
git add packages/execution-core apps/desktop/src/main/execution apps/desktop/tests
git commit -m "feat: cache hyperliquid market universe"
```

### Task 7: Enforce DEX identity, active-market safety, and shared risk limits

**Files:**
- Modify: `packages/execution-core/src/risk-engine.ts`
- Test: `packages/execution-core/src/risk-engine.test.ts`
- Modify: `apps/desktop/src/main/execution/paper-adapter.ts`
- Test: `apps/desktop/tests/paper-deployment.test.ts`

**Interfaces:**
- Risk input includes Bot/deployment/evaluation DEX identity and the exact universe metadata revision.
- Risk distinguishes position-increasing from provably reducing intents.

- [ ] **Step 1: Write failing identity and binding tests**

```ts
expect(evaluateRisk({ ...input, botDex: 'hyperliquid', deploymentDex: 'hyperliquid', effectMarket: 'ETH-PERP' }).approved).toBe(true);
expect(evaluateRisk({ ...input, effectMarket: 'BTC-PERP' })).toMatchObject({
  approved: false, violatedRuleIds: ['evaluation-market-mismatch'],
});
expect(evaluateRisk({ ...input, deploymentDex: 'other' as never })).toMatchObject({
  approved: false, violatedRuleIds: ['dex-mismatch'],
});
```

- [ ] **Step 2: Write failing active/inactive and portfolio tests**

```ts
expect(evaluateRisk(openOnInactive)).toMatchObject({ approved: false, violatedRuleIds: ['market-inactive'] });
expect(evaluateRisk(closeLongOnInactive).approved).toBe(true);
expect(evaluateRisk(closeWithoutKnownPosition)).toMatchObject({ approved: false, violatedRuleIds: ['reduction-unproven'] });
expect(evaluateRisk(overPortfolioExposure)).toMatchObject({ approved: false, violatedRuleIds: ['max-total-exposure-usd'] });
expect(evaluateRisk(staleMetadata)).toMatchObject({ approved: false, violatedRuleIds: ['market-metadata-stale'] });
```

- [ ] **Step 3: Run risk tests and confirm RED**

Run: `pnpm --filter @catbots/execution-core exec vitest run src/risk-engine.test.ts`

Expected: FAIL because current risk depends on an allow-list and has no universe or identity checks.

- [ ] **Step 4: Implement fail-closed dynamic-market risk**

```ts
export type RiskEvaluationInput = Readonly<{
  intent: NormalizedOrderIntent;
  limits: RiskLimits;
  account: RiskAccountState | undefined;
  botDex: DexId;
  deploymentDex: DexId;
  currentMarket: string;
  marketMetadata: PerpMarket | undefined;
  universeFresh: boolean;
  evaluatedAt: string;
}>;
```

Remove the fixed `allowed-market` test for dynamic deployments. Check DEX identity, `intent.market === currentMarket`, fresh metadata membership, active state for increases, per-market position exposure, total portfolio exposure, side, leverage, loss, drawdown, and the shared rate budget. A close is reducing only when the known position and close intent reduce absolute exposure.

- [ ] **Step 5: Update Paper to consume the same rules**

Paper uses the selected DEX snapshot but no venue credentials. Its normalized intents take `effect.market`, and all positions/orders remain keyed by market.

- [ ] **Step 6: Run risk and Paper suites**

Run: `pnpm --filter @catbots/execution-core test && pnpm --filter @catbots/desktop exec vitest run tests/paper-deployment.test.ts`

Expected: PASS with new-listing increases allowed after refresh and inactive-market closes preserved.

- [ ] **Step 7: Commit**

```sh
git add packages/execution-core apps/desktop/src/main/execution/paper-adapter.ts apps/desktop/tests/paper-deployment.test.ts
git commit -m "feat: enforce dynamic market execution risk"
```

### Task 8: Persist parent/child market traces and dynamic deployments

**Files:**
- Modify: `apps/desktop/src/main/storage/migrations.ts`
- Modify: `apps/desktop/src/main/execution/execution-repository.ts`
- Modify: `apps/desktop/src/main/execution/deployment-service.ts`
- Modify: `apps/desktop/src/main/execution/outbox-executor.ts`
- Modify: `apps/desktop/src/main/execution/reconciliation-service.ts`
- Test: `apps/desktop/tests/execution-repository.test.ts`
- Test: `apps/desktop/tests/paper-deployment.test.ts`
- Test: `apps/desktop/tests/live-deployment-service.test.ts`
- Test: `apps/desktop/tests/live-execution.test.ts`
- Test: `apps/desktop/tests/reconciliation.test.ts`

**Interfaces:**
- Migration 5 adds parent trace, market, DEX, universe revision, and context metadata without mutating existing append-only events.
- New deployment paths require Strategy 2.0 and dynamic scope; legacy deployments remain readable/stoppable only.

- [ ] **Step 1: Write failing durable trace tests**

```ts
await service.ingest(intervalInputWithTwoMarkets);
const traces = repository.listTriggerRun(parentTraceId);
expect(traces.children.map(({ market }) => market)).toEqual(['BTC-PERP', 'ETH-PERP']);
expect(traces.children.every(({ universeRevision }) => universeRevision === 'sha256:fixture')).toBe(true);
expect(repository.listDeploymentAuditEvents(deploymentId)).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'condition.evaluated', market: 'ETH-PERP' }),
  expect.objectContaining({ type: 'risk.approved', market: 'ETH-PERP' }),
]));
```

- [ ] **Step 2: Write failing deployment-compatibility tests**

```ts
expect(service.startPaper(dynamicInput)).toMatchObject({
  recordVersion: 2, dex: 'hyperliquid', executionVenue: 'paper',
  marketAccess: { mode: 'all_active_perpetuals' },
});
expect(() => service.startPaper({ ...dynamicInput, strategyVersion: legacyV1 })).toThrow('Strategy 2.0 is required');
expect(service.stop(legacyDeploymentId).status).toBe('stopped');
```

- [ ] **Step 3: Run persistence/execution tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/execution-repository.test.ts tests/paper-deployment.test.ts tests/live-deployment-service.test.ts tests/live-execution.test.ts tests/reconciliation.test.ts`

Expected: FAIL because traces lack market hierarchy and new deployments still bind one market.

- [ ] **Step 4: Add migration 5 and repository methods**

Add nullable legacy-compatible columns to `audit_traces`: `parent_trace_id`, `market`, `dex`, `universe_revision`, `context_observed_at`. Add indexes for `(deployment_id, parent_trace_id)` and `(deployment_id, market, created_at)`. Store sanitized data-reference freshness in audit event JSON; do not store raw provider payloads or errors.

- [ ] **Step 5: Coordinate Paper and Live execution**

Refresh the DEX universe before start, construct record-version-2 deployments, and pass interval/Event inputs to `coordinateEvaluation`. For each child, persist Condition and Action context, call Task 7 risk evaluation with the same `currentMarket`, and atomically persist Action proposal, risk approval, and outbox intent before Live adapter submission.

- [ ] **Step 6: Verify retry and reconciliation identities include market**

```ts
const key = executionIdempotencyKey({
  deploymentId, strategyVersion, parentTraceId, childTraceId, market: effect.market, actionNodeId,
});
```

Duplicate parent triggers create no duplicate child orders. Adapter retry, fill, and reconciliation records retain the same market and child trace.

- [ ] **Step 7: Run execution suites and typecheck**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/execution-repository.test.ts tests/paper-deployment.test.ts tests/live-deployment-service.test.ts tests/live-execution.test.ts tests/reconciliation.test.ts && pnpm --filter @catbots/desktop typecheck`

Expected: PASS for append-only market traces, transaction rollback, duplicate triggers, restart recovery, and legacy stop.

- [ ] **Step 8: Commit**

```sh
git add apps/desktop/src/main/storage apps/desktop/src/main/execution apps/desktop/tests
git commit -m "feat: execute and audit dynamic market deployments"
```

### Task 9: Teach the Agent and Backtest Tool dynamic-market semantics

**Files:**
- Modify: `apps/desktop/src/main/agent/agent-tools.ts`
- Modify: `apps/desktop/src/main/agent/agent-loop.ts`
- Modify: `apps/desktop/src/main/workbench/workbench-service.ts`
- Modify: `apps/desktop/src/main/workbench/sample-backtest-data.ts`
- Test: `apps/desktop/tests/agent-tools.test.ts`
- Test: `apps/desktop/tests/agent-loop.test.ts`
- Test: `apps/desktop/tests/workbench-service.test.ts`
- Test: `apps/desktop/tests/sample-backtest-data.test.ts`

**Interfaces:**
- New Agent-generated revisions are Strategy 2.0.
- Backtest Tool receives `marketUniverse`; sample data declares limited point-in-time coverage.

- [ ] **Step 1: Write failing Agent schema and prompt tests**

```ts
expect(validateTool.inputSchema).toMatchObject({
  properties: {
    strategy: { properties: { schemaVersion: { const: '2.0' }, marketScope: { type: 'object' } } },
  },
});
expect(systemPrompt(state)).toContain('DEX: Hyperliquid; market scope: dynamic');
expect(systemPrompt(state)).toContain('“sell ETH” means close/reduce an ETH long');
expect(systemPrompt(state)).toContain('opening a short requires explicit short intent');
```

- [ ] **Step 2: Write the failing ETH RSI behavior test**

```ts
await runAgentTurn(userSays('ซื้อ ETH เมื่อ RSI <20 และขาย ETH เมื่อ RSI>80'), dependencies);
expect(savedRevision.document).toMatchObject({
  schemaVersion: '2.0', marketScope: { type: 'dex_universe' },
});
expect(savedRevision.document.nodes).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'predicate.compare', config: expect.objectContaining({ left: { ref: 'market.symbol' }, right: { literal: 'ETH-PERP' } }) }),
  expect.objectContaining({ type: 'execution.open_position', config: expect.objectContaining({ side: 'long' }) }),
  expect.objectContaining({ type: 'execution.close_position' }),
]));
expect(savedRevision.document.nodes).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'execution.open_position', config: expect.objectContaining({ side: 'short' }) }),
]));
```

- [ ] **Step 3: Run Agent/Workbench tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/agent-tools.test.ts tests/agent-loop.test.ts tests/workbench-service.test.ts tests/sample-backtest-data.test.ts`

Expected: FAIL because prompts/tools still receive one Bot market and emit Strategy 1.0.

- [ ] **Step 4: Update Agent tools and prompt**

Remove `market` from `AgentToolDependencies`; pass `dex` and Backtest dataset catalog instead. Expose `market.symbol`, market-relative price/funding/volume/rank, and indicator references. The system prompt requires a symbol Condition for named pairs, screeners for broad requirements, explicit Short intent, and honest dataset coverage.

- [ ] **Step 5: Replace the one-market sample fixture**

Bundle at least BTC-PERP and ETH-PERP frames with a listing boundary, market-keyed price/indicator values, and declared date coverage. `runBundledSampleBacktest` calls the Task 5 universe API and maps aggregate/per-market outputs into the Task 1 summary.

- [ ] **Step 6: Run Agent/Workbench suites**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/agent-tools.test.ts tests/agent-loop.test.ts tests/workbench-service.test.ts tests/sample-backtest-data.test.ts tests/lmstudio-workbench.e2e.test.ts`

Expected: PASS; the LM Studio test remains skipped unless its explicit environment flag is enabled.

- [ ] **Step 7: Commit**

```sh
git add apps/desktop/src/main/agent apps/desktop/src/main/workbench apps/desktop/tests
git commit -m "feat: teach agent dynamic market strategies"
```

### Task 10: Replace the Create Bot market field with one DEX selector

**Files:**
- Modify: `apps/desktop/src/renderer/screens/CreateDraftBotDialog.tsx`
- Modify: `apps/desktop/src/renderer/screens/BotsHomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Test: `apps/desktop/tests/bots-home.test.tsx`

**Interfaces:**
- Renderer submits exactly `{ name, dex: 'hyperliquid' }`.
- Kumo UI contains one real single-select with one Hyperliquid option and no future-support message.

- [ ] **Step 1: Write failing accessible UI tests**

```tsx
expect(screen.getByLabelText('Bot name')).toBeVisible();
expect(screen.getByLabelText('DEX')).toHaveValue('hyperliquid');
expect(screen.queryByLabelText('Market')).not.toBeInTheDocument();
expect(screen.queryByText(/coming soon|future DEX/i)).not.toBeInTheDocument();
await user.type(screen.getByLabelText('Bot name'), 'ETH RSI');
await user.click(screen.getByRole('button', { name: 'Create draft' }));
expect(api.createDraft).toHaveBeenCalledWith({ name: 'ETH RSI', dex: 'hyperliquid' });
```

- [ ] **Step 2: Write failing Bot table test**

```tsx
expect(screen.getByRole('columnheader', { name: 'DEX' })).toBeVisible();
expect(screen.getByText('Hyperliquid')).toBeVisible();
expect(screen.queryByRole('columnheader', { name: 'Market' })).not.toBeInTheDocument();
```

- [ ] **Step 3: Run renderer tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/bots-home.test.tsx`

Expected: FAIL because the dialog and list still use `market`.

- [ ] **Step 4: Implement the exact approved dialog**

Use the installed Kumo `Select` directly:

```tsx
<Select label="DEX" value={form.dex} onValueChange={(dex) => updateForm('dex', dex)} disabled={isCreating}>
  <Select.Option value="hyperliquid">Hyperliquid</Select.Option>
</Select>
```

The only fields are Bot name and DEX; actions remain Cancel and Create draft. Update empty-state copy to describe a DEX-scoped strategy workspace.

- [ ] **Step 5: Run tests and renderer typecheck**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/bots-home.test.tsx && pnpm --filter @catbots/desktop typecheck`

Expected: PASS with keyboard submission and accessible labels.

- [ ] **Step 6: Commit**

```sh
git add apps/desktop/src/renderer/screens/CreateDraftBotDialog.tsx apps/desktop/src/renderer/screens/BotsHomeScreen.tsx apps/desktop/src/renderer/app.css apps/desktop/tests/bots-home.test.tsx
git commit -m "feat: create bots by dex"
```

### Task 11: Show dynamic scope, multi-market Backtest, and market traces in React Flow UI

**Files:**
- Modify: `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/LiveReviewScreen.tsx`
- Modify: `apps/desktop/src/renderer/workbench/WorkbenchHeader.tsx`
- Modify: `apps/desktop/src/renderer/workbench/StrategyGraph.tsx`
- Modify: `apps/desktop/src/renderer/workbench/BacktestPanel.tsx`
- Modify: `apps/desktop/src/renderer/workbench/TraceTimeline.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Test: `apps/desktop/tests/bot-workbench.test.tsx`
- Test: `apps/desktop/tests/strategy-graph.test.tsx`
- Test: `apps/desktop/tests/backtest-panel.test.tsx`
- Test: `apps/desktop/tests/live-review.test.tsx`

**Interfaces:**
- Graph remains Trigger → Condition → Action; DEX/scope appears as compact metadata, never a fourth node.
- Backtest renders aggregate metrics, per-market breakdown, coverage, and parent/child trace navigation.

- [ ] **Step 1: Write failing scope and graph tests**

```tsx
expect(screen.getByText('Hyperliquid · Dynamic markets')).toBeVisible();
expect(screen.getByText('All active perpetual markets')).toBeVisible();
expect(screen.getAllByTestId('strategy-node').map((node) => node.dataset.kind)).toEqual([
  'trigger', 'condition', 'condition', 'action',
]);
expect(screen.queryByText('Market scope', { selector: '[data-testid="strategy-node"] *' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Write failing Backtest and trace tests**

```tsx
expect(screen.getByRole('heading', { name: 'Portfolio performance' })).toBeVisible();
expect(screen.getByRole('heading', { name: 'By market' })).toBeVisible();
expect(screen.getByRole('row', { name: /ETH-PERP/ })).toBeVisible();
await user.click(screen.getByRole('button', { name: /interval run/i }));
expect(screen.getByText('ETH-PERP')).toBeVisible();
expect(screen.getByText('Universe revision')).toBeVisible();
```

- [ ] **Step 3: Write failing Live review test**

```tsx
expect(screen.getByText('DEX: Hyperliquid')).toBeVisible();
expect(screen.getByText('Market access: All active perpetual markets')).toBeVisible();
expect(screen.getByText(/Universe data.*fresh/i)).toBeVisible();
expect(screen.queryByText(/Market: ETH-PERP/)).not.toBeInTheDocument();
```

- [ ] **Step 4: Run focused UI tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/bot-workbench.test.tsx tests/strategy-graph.test.tsx tests/backtest-panel.test.tsx tests/live-review.test.tsx`

Expected: FAIL because UI assumes one Bot market and flat traces.

- [ ] **Step 5: Implement Kumo/React Flow presentation**

Replace fixed-market defaults with portfolio risk defaults including `maxTotalExposureUsd`. Add a compact scope row above the React Flow canvas. Add a per-market Kumo table below aggregate Backtest metrics. Group traces by `parentTraceId`, then reveal each market child and its Condition/Action/risk/execution events. Live/Paper review displays DEX, dynamic market access, metadata freshness, and risk limits.

- [ ] **Step 6: Run UI tests and typecheck**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/bot-workbench.test.tsx tests/strategy-graph.test.tsx tests/backtest-panel.test.tsx tests/live-review.test.tsx && pnpm --filter @catbots/desktop typecheck`

Expected: PASS with only three graph node kinds and accessible scope/trace navigation.

- [ ] **Step 7: Commit**

```sh
git add apps/desktop/src/renderer apps/desktop/tests
git commit -m "feat: visualize dynamic market bot scope"
```

### Task 12: Update IPC, Web Preview, and end-to-end workflows

**Files:**
- Modify: `apps/desktop/src/main/ipc/register-ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/web-preview-api.ts`
- Test: `apps/desktop/tests/ipc-security.test.ts`
- Test: `apps/desktop/tests/web-preview-api.test.ts`
- Modify: `e2e/web-preview-workflow.spec.ts`
- Modify: `e2e/desktop-smoke.spec.ts`

**Interfaces:**
- IPC validates Task 1 request schemas at Main and returns only renderer-safe dynamic-market DTOs.
- Web Preview simulates the real contract and multi-market workflow; it is not a separate product model.

- [ ] **Step 1: Write failing IPC and preview contract tests**

```ts
await expect(api.bots.createDraft({ name: 'DEX bot', dex: 'hyperliquid' })).resolves.toMatchObject({ dex: 'hyperliquid' });
await expect(api.bots.createDraft({ name: 'Old bot', market: 'ETH-PERP' })).rejects.toThrow();
expect(await api.workbench.runBacktest({
  botId, revisionVersion: 1, marketUniverse: { mode: 'all_available' }, assumptions,
})).toMatchObject({ perMarket: expect.any(Array), datasetCoverage: expect.any(Object) });
```

- [ ] **Step 2: Update failing E2E expectations**

```ts
await page.getByLabel('Bot name').fill('ETH RSI');
await expect(page.getByLabel('DEX')).toHaveValue('hyperliquid');
await page.getByRole('button', { name: 'Create draft' }).click();
await expect(page.getByText('Hyperliquid · Dynamic markets')).toBeVisible();
await expect(page.getByText('ETH-PERP')).toBeVisible();
await expect(page.getByRole('heading', { name: 'By market' })).toBeVisible();
```

- [ ] **Step 3: Run IPC/preview tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/ipc-security.test.ts tests/web-preview-api.test.ts`

Expected: FAIL because preview and IPC still construct market-bound Bots/deployments.

- [ ] **Step 4: Implement contract parity**

Update Main handlers and preload types without exposing raw universe/provider data. Update Web Preview fixtures to Bot DEX, Strategy 2.0, a BTC/ETH point-in-time universe, dynamic deployments, per-market summaries, and parent/child traces. Preserve its explicit simulated-data labeling.

- [ ] **Step 5: Run desktop tests and both E2E workflows**

Because Electron development uses its native ABI, stop the active `pnpm dev` process before the full suite, run the repository orchestrator, then restart development afterward.

Run: `pnpm test && pnpm typecheck && pnpm test:e2e`

Expected: PASS for unit, integration, Web Preview, packaged Electron smoke, restart persistence, and no fixed-market create step.

- [ ] **Step 6: Commit**

```sh
git add packages/contracts/src/ipc.ts apps/desktop/src/main/ipc apps/desktop/src/preload apps/desktop/src/renderer/web-preview-api.ts apps/desktop/tests e2e
git commit -m "test: cover dynamic market desktop workflow"
```

### Task 13: Verify migration, safety invariants, and documentation

**Files:**
- Modify: `README.md`
- Create: `docs/dynamic-markets.md`
- Test: `apps/desktop/tests/database.test.ts`
- Test: `apps/desktop/tests/live-execution.test.ts`
- Test: `e2e/desktop-smoke.spec.ts`

**Interfaces:**
- Documents the exact user workflow and compatibility rules.
- Provides final evidence that no market can escape current-market binding and every path is logged.

- [ ] **Step 1: Add final acceptance assertions**

```ts
expect(migratedBot).toMatchObject({ dex: 'hyperliquid' });
expect(migratedLegacyStrategy.schemaVersion).toBe('1.0');
expect(migratedLegacyDeployment.marketBindings).toEqual(['BTC-PERP']);
expect(dynamicAction.market).toBe(dynamicChildTrace.market);
expect(types(dynamicChildTrace)).toEqual(expect.arrayContaining([
  'trigger.received', 'condition.evaluated', 'action.proposed',
  'risk.approved', 'execution.queued', 'execution.filled', 'flow.completed',
]));
expect(secretScan(JSON.stringify(dynamicChildTrace))).toEqual([]);
```

- [ ] **Step 2: Run the acceptance tests and confirm they fail if an invariant is removed**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/live-execution.test.ts`

Expected: PASS on the completed implementation; temporarily changing an expected bound market demonstrates the test goes RED, then restore it.

- [ ] **Step 3: Document behavior and recovery**

Document:

- Create Bot with name + Hyperliquid DEX.
- Chat-based fixed-symbol and screener Strategies.
- Strategy 2.0 current-market Action binding.
- point-in-time Backtest coverage and per-market metrics.
- Paper versus Hyperliquid testnet behavior.
- automatic listing eligibility and inactive-market close-only behavior.
- legacy Strategy/deployment compatibility and repair-mode behavior after migration failure.
- the rule that “sell” closes/reduces Long unless Short is explicit.

- [ ] **Step 4: Run placeholder, fixed-market, and secret scans**

Run: `rg -n "state\.bot\.market|bot\.market|marketBindings: \[|allowedMarkets|Create a local draft with a name and market" packages apps/desktop/src e2e`

Expected: no results outside explicitly named legacy compatibility code/tests.

Run: `rg -n "TODO|TBD|implement later|coming soon|future DEX" docs/dynamic-markets.md apps/desktop/src/renderer`

Expected: no results.

Run: `rg -n "agentPrivateKey|apiKey" apps/desktop/src/renderer packages/contracts/src/workbench.ts packages/contracts/src/execution.ts`

Expected: no renderer-safe DTO or UI output contains secret values; legitimate Settings input types are reviewed individually.

- [ ] **Step 5: Run complete verification from a clean process state**

Run: `pnpm test && pnpm typecheck && pnpm test:e2e && git diff --check`

Expected: PASS with no formatting errors. Launch `pnpm dev`, create a Hyperliquid Bot without selecting a pair, inspect `Hyperliquid · Dynamic markets`, run the ETH RSI Backtest, approve it, start Paper, confirm market-specific logs, stop it, and restart the app to confirm persistence.

- [ ] **Step 6: Commit documentation and final acceptance coverage**

```sh
git add README.md docs apps/desktop/tests e2e/desktop-smoke.spec.ts
git commit -m "docs: explain dex scoped dynamic market bots"
```
