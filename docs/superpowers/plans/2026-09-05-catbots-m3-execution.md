# Catbots M3 Paper and Hyperliquid Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable Paper execution and fail-closed Hyperliquid testnet execution without changing canonical Strategy Graph semantics.

**Architecture:** Add a renderer-independent execution package containing venue-neutral adapter, risk, idempotency, and reconciliation contracts. Electron Main persists deployments, audit events, and a transactional outbox in SQLite; the supervised runtime worker evaluates the approved strategy and hands proposed effects to Paper or Hyperliquid adapters only after durable risk approval. Paper ships first, then Hyperliquid testnet; mainnet remains disabled.

**Tech Stack:** TypeScript, Zod, Vitest, better-sqlite3, Electron utility process, React 19, Cloudflare Kumo, Hyperliquid HTTP/WebSocket API.

**Spec:** `docs/superpowers/specs/2026-09-03-tca-perp-bot-design.md` sections 9–10 and 13–18; `docs/superpowers/specs/2026-09-03-catbots-desktop-ui-design.md` sections 11–13 and 15–21; `docs/superpowers/plans/2026-09-03-catbots-delivery-roadmap.md` M3.

## Global Constraints

- Paper and Live evaluate the same immutable approved Strategy version through `@catbots/strategy-runtime`.
- Every Trigger activation receives one `traceId`; terminal traces are append-only and sequence numbers are contiguous.
- Live writes `action.proposed`, `risk.approved`, and an outbox item atomically before an adapter side effect.
- Duplicate trigger events and retries reuse deterministic idempotency and client-order IDs.
- Missing data, failed risk checks, failed audit writes, failed reconciliation, or an unapproved Agent wallet block Live execution.
- Hyperliquid mainnet is not selectable in M3; acceptance uses testnet only.
- Secrets stay in Electron Main and never enter renderer DTOs, logs, diagnostics, traces, or Agent prompts.
- The Settings Form remains the only writer of `local.env.yaml`; no raw YAML editor is added.

---

### Task 1: Define deployment, risk, audit, and execution contracts

**Files:**
- Create: `packages/contracts/src/execution.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Test: `packages/contracts/src/execution.test.ts`

**Interfaces:**
- Consumes: existing `BotStatus`, strategy revision version, and ISO datetime conventions.
- Produces: `DeploymentSchema`, `RiskLimitsSchema`, `AuditEventViewSchema`, `StartPaperInputSchema`, `PrepareLiveInputSchema`, `StartLiveInputSchema`, `StopDeploymentInputSchema`, and renderer-safe DTOs. `CatbotsDesktopApi` gains deployment methods in Task 5 together with their real service implementation.

- [x] **Step 1: Write failing schema tests**

```ts
expect(DeploymentSchema.safeParse({ mode: 'paper', strategyVersion: 1, allowedMarkets: ['BTC-PERP'] }).success).toBe(true);
expect(RiskLimitsSchema.safeParse({ maxOrderUsd: '0', maxPositionUsd: '1000', maxLeverage: 2 }).success).toBe(false);
expect(JSON.stringify(LivePreflightViewSchema.parse(fixture))).not.toContain('privateKey');
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @catbots/contracts exec vitest run src/execution.test.ts`

Expected: FAIL because the execution schemas are not exported.

- [x] **Step 3: Implement strict discriminated contracts**

```ts
export const DeploymentModeSchema = z.enum(['paper', 'live']);
export const RiskLimitsSchema = z.object({
  maxOrderUsd: PositiveDecimalStringSchema,
  maxPositionUsd: PositiveDecimalStringSchema,
  maxLeverage: z.number().int().min(1).max(50),
  maxDailyLossUsd: PositiveDecimalStringSchema,
  maxDrawdownPercent: z.number().positive().max(100),
  allowedMarkets: z.array(z.string().min(1)).min(1),
  allowedSides: z.array(z.enum(['long', 'short'])).min(1),
  maxOrdersPerMinute: z.number().int().positive(),
}).strict();
```

Define request schemas with UUID bot/deployment IDs and an exact strategy version. Live confirmation contains the exact bot name but never credentials.

- [x] **Step 4: Run contracts tests and typecheck**

Run: `pnpm --filter @catbots/contracts test && pnpm --filter @catbots/contracts typecheck`

Expected: PASS with invalid limits and secret-shaped fields rejected.

- [x] **Step 5: Commit**

```sh
git add packages/contracts
git commit -m "feat: define execution and deployment contracts"
```

### Task 2: Add the venue-neutral execution and Risk Engine package

**Files:**
- Create: `packages/execution-core/package.json`
- Create: `packages/execution-core/tsconfig.json`
- Create: `packages/execution-core/src/adapter.ts`
- Create: `packages/execution-core/src/risk-engine.ts`
- Create: `packages/execution-core/src/idempotency.ts`
- Create: `packages/execution-core/src/index.ts`
- Test: `packages/execution-core/src/risk-engine.test.ts`
- Test: `packages/execution-core/src/idempotency.test.ts`

**Interfaces:**
- Consumes: normalized `ProposedEffect` from `@catbots/strategy-runtime` and Task 1 risk limits.
- Produces: `PerpDexAdapter`, normalized order/balance/position/event types, `evaluateRisk(input): RiskDecision`, `executionIdempotencyKey(input): string`, and `clientOrderId(input): string`.

- [x] **Step 1: Write risk-boundary and deterministic-ID tests**

```ts
expect(evaluateRisk({ ...fixture, proposedOrderUsd: '1001' })).toMatchObject({ approved: false, violatedRuleIds: ['max-order-usd'] });
expect(executionIdempotencyKey(fixture)).toBe(executionIdempotencyKey(structuredClone(fixture)));
expect(clientOrderId(fixture)).toMatch(/^cb_[a-f0-9]{28}$/);
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @catbots/execution-core test`

Expected: FAIL because the package and functions do not exist.

- [x] **Step 3: Implement pure contracts and fail-closed risk evaluation**

```ts
export interface PerpDexAdapter {
  getMarkets(signal: AbortSignal): Promise<readonly PerpMarket[]>;
  getBalances(account: string, signal: AbortSignal): Promise<readonly PerpBalance[]>;
  getPositions(account: string, signal: AbortSignal): Promise<readonly PerpPosition[]>;
  placeOrder(order: NormalizedOrderIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  cancelOrder(order: CancelOrderIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  updateLeverage(input: UpdateLeverageIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  closePosition(input: ClosePositionIntent, signal: AbortSignal): Promise<ExecutionReceipt>;
  getExecutionEvents(cursor: string | null, signal: AbortSignal): Promise<ExecutionEventPage>;
}
```

Use decimal strings at boundaries and return a rejected decision when account state, limits, or required valuation is unavailable.

- [x] **Step 4: Run execution-core tests and workspace typecheck**

Run: `pnpm --filter @catbots/execution-core test && pnpm typecheck`

Expected: PASS with every rule ID asserted at its exact boundary.

- [x] **Step 5: Commit**

```sh
git add packages/execution-core pnpm-lock.yaml
git commit -m "feat: add venue neutral risk and execution core"
```

### Task 3: Persist deployments, ordered audit events, and transactional outbox items

**Files:**
- Modify: `apps/desktop/src/main/storage/migrations.ts`
- Create: `apps/desktop/src/main/execution/execution-repository.ts`
- Test: `apps/desktop/tests/execution-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 deployment DTOs and Task 2 deterministic IDs.
- Produces: `ExecutionRepository.createDeployment`, `appendTerminalTrace`, `proposeLiveAction`, `claimOutboxItem`, `recordAdapterOutcome`, `requestStop`, and `listRecoverableDeployments`.

- [x] **Step 1: Write failing transaction and immutability tests**

```ts
expect(() => repository.proposeLiveAction(fixture, { failAuditWrite: true })).toThrow();
expect(adapterSideEffects).toHaveLength(0);
expect(repository.claimOutboxItem(key)?.idempotencyKey).toBe(key);
expect(repository.claimOutboxItem(key)).toBeNull();
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/execution-repository.test.ts`

Expected: FAIL because migration 3 and the repository do not exist.

- [x] **Step 3: Add migration 3 and transaction methods**

Create `deployments`, `audit_traces`, `audit_events`, and `execution_outbox` tables. Enforce unique `(trace_id, sequence)`, unique `idempotency_key`, immutable strategy binding, and checked lifecycle states. `proposeLiveAction` must insert proposed/risk events and the pending outbox row in one `better-sqlite3` transaction.

- [x] **Step 4: Run migration, rollback, deduplication, and redaction tests**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/execution-repository.test.ts`

Expected: PASS; forced transaction failure leaves no audit or outbox row.

- [x] **Step 5: Commit**

```sh
git add apps/desktop/src/main/storage apps/desktop/src/main/execution apps/desktop/tests
git commit -m "feat: persist execution audit outbox"
```

### Task 4: Run approved strategies in Paper mode

**Files:**
- Create: `apps/desktop/src/main/execution/paper-adapter.ts`
- Create: `apps/desktop/src/main/execution/deployment-service.ts`
- Test: `apps/desktop/tests/paper-deployment.test.ts`

**Interfaces:**
- Consumes: approved revisions, live event snapshots, Task 2 risk decisions, and Task 3 repository.
- Produces: `DeploymentService.startPaper`, `ingestEvent`, `pause`, `stop`, and Paper positions/performance/audit views.

- [x] **Step 1: Write a failing Paper parity test**

```ts
const paper = await harness.startPaper({ botId, strategyVersion: 1, riskLimits });
await harness.ingest(intervalEvent);
expect(paper.adapter.orders).toHaveLength(1);
expect(harness.trace()).toHaveContiguousTypes(['trigger.received', 'risk.approved', 'execution.filled', 'flow.completed']);
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/paper-deployment.test.ts`

Expected: FAIL because Paper deployment is unavailable.

- [x] **Step 3: Implement Paper using the canonical evaluator**

Resolve one immutable context per trigger, call `evaluateTrigger`, pass proposed effects through `evaluateRisk`, append every result, and fill approved normalized intents in `PaperAdapter`. Deduplicate by trigger event ID plus action node ID. Stop persists before the worker acknowledges it.

- [x] **Step 4: Run parity, restart, duplicate-event, and audit-failure tests**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/paper-deployment.test.ts tests/runtime-supervisor.test.ts`

Expected: PASS; duplicate events create one Paper order and restart never resumes a stopped deployment.

- [x] **Step 5: Commit**

```sh
git add apps/desktop/src/main/execution apps/desktop/src/main/runtime apps/desktop/tests
git commit -m "feat: execute approved bots in paper mode"
```

### Task 5: Expose Paper Run, Stop, Performance, and Logs through secure IPC

**Files:**
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `apps/desktop/src/main/ipc/register-ipc.ts`
- Modify: `apps/desktop/src/main/runtime/runtime-worker.ts`
- Modify: `apps/desktop/src/main/runtime/runtime-supervisor.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- Create: `apps/desktop/src/renderer/workbench/PerformancePanel.tsx`
- Create: `apps/desktop/src/renderer/workbench/ExecutionLogPanel.tsx`
- Test: `apps/desktop/tests/ipc-handlers.test.ts`
- Test: `apps/desktop/tests/workbench.test.tsx`
- Modify: `e2e/desktop-smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 4 deployment service.
- Produces: renderer-safe `deployments.startPaper`, `deployments.stop`, `deployments.get`, and `deployments.subscribeActivity` APIs.

- [x] **Step 1: Write failing IPC and UI tests**

```ts
await user.click(screen.getByRole('button', { name: 'Run' }));
await user.click(screen.getByRole('menuitem', { name: 'Paper' }));
expect(api.startPaper).toHaveBeenCalledWith(expect.objectContaining({ strategyVersion: 1 }));
expect(screen.getByRole('button', { name: 'Stop bot' })).toBeVisible();
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/ipc-handlers.test.ts tests/workbench.test.tsx`

Expected: FAIL because Paper APIs and enabled controls are absent.

- [x] **Step 3: Implement validated IPC and Kumo UI**

Require a valid approved revision, writable audit storage, and confirmation. Show explicit `Paper` mode, PnL/positions, append-only trace summaries, last event time, audit health, and a persistent Stop control. Keep Live routed to its dedicated review page and disabled until Task 8 preflight passes.

- [x] **Step 4: Run renderer, IPC, and packaged Paper E2E tests**

Run: `pnpm --filter @catbots/desktop test && pnpm test:e2e`

Expected: PASS with create → approve → Run Paper → event → inspect trace → Stop persisting across restart.

- [x] **Step 5: Commit**

```sh
git add packages/contracts apps/desktop/src apps/desktop/tests e2e
git commit -m "feat: add paper run and stop experience"
```

### Task 6: Implement the Hyperliquid testnet adapter and Agent Wallet preflight

**Files:**
- Create: `apps/desktop/src/main/execution/hyperliquid/hyperliquid-adapter.ts`
- Create: `apps/desktop/src/main/execution/hyperliquid/hyperliquid-client.ts`
- Create: `apps/desktop/src/main/execution/hyperliquid/hyperliquid-normalization.ts`
- Create: `apps/desktop/src/main/execution/hyperliquid/hyperliquid-preflight.ts`
- Test: `apps/desktop/tests/hyperliquid-adapter.test.ts`
- Test: `apps/desktop/tests/hyperliquid-preflight.test.ts`

**Interfaces:**
- Consumes: Task 2 `PerpDexAdapter` and existing local Hyperliquid Agent/API Wallet configuration.
- Produces: `HyperliquidAdapter` and `runHyperliquidPreflight(config, account, signal): Promise<LivePreflightView>` for testnet only.

- [x] **Step 1: Write failing fixture-based adapter tests**

```ts
expect(await adapter.getPositions(account, signal)).toEqual([expect.objectContaining({ market: 'BTC-PERP', side: 'long' })]);
expect(sentOrder.clientOrderId).toBe(intent.clientOrderId);
expect(await preflight(masterWalletFixture)).toMatchObject({ ready: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'agent-wallet', ok: false })]) });
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/hyperliquid-adapter.test.ts tests/hyperliquid-preflight.test.ts`

Expected: FAIL because the adapter is absent.

- [x] **Step 3: Implement HTTP signing, normalization, and preflight behind injected transport**

Map only normalized contract fields. Allow only Hyperliquid testnet base URLs, bound response bytes/timeouts, redact headers and signatures, verify the configured signer is an approved Agent/API Wallet for the account, and include network, masked account, balance, runtime, audit, data, Backtest, and reconciliation checks.

- [x] **Step 4: Run contract fixtures and safe-error tests**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/hyperliquid-adapter.test.ts tests/hyperliquid-preflight.test.ts tests/config-repository.test.ts`

Expected: PASS; malformed/oversized/timeout responses use fixed error codes and expose no secret.

- [x] **Step 5: Commit**

```sh
git add apps/desktop/src/main/execution/hyperliquid apps/desktop/tests pnpm-lock.yaml
git commit -m "feat: add hyperliquid testnet adapter"
```

### Task 7: Execute Live outbox items idempotently and reconcile uncertain outcomes

**Files:**
- Create: `apps/desktop/src/main/execution/outbox-executor.ts`
- Create: `apps/desktop/src/main/execution/reconciliation-service.ts`
- Modify: `apps/desktop/src/main/execution/deployment-service.ts`
- Test: `apps/desktop/tests/live-execution.test.ts`
- Test: `apps/desktop/tests/reconciliation.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, and 6.
- Produces: `OutboxExecutor.runOnce`, `ReconciliationService.reconcileDeployment`, and fail-closed Live lifecycle transitions.

- [x] **Step 1: Write failing lost-response and audit-outage tests**

```ts
await expect(harness.executeWithLostResponse()).rejects.toMatchObject({ code: 'EXECUTION_OUTCOME_UNKNOWN' });
await harness.reconcile();
expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
expect(harness.outboxItem()).toMatchObject({ status: 'acknowledged' });
expect(() => harness.proposeWithBrokenAudit()).toThrow();
expect(adapter.placeOrder).not.toHaveBeenCalled();
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/live-execution.test.ts tests/reconciliation.test.ts`

Expected: FAIL because no Live executor exists.

- [x] **Step 3: Implement bounded claim, submit, record, and reconcile transitions**

Claim pending rows atomically, submit using the persisted client-order ID, record sanitized outcomes, and never blindly retry an unknown result. Query orders/positions before retry; suspend the deployment when reconciliation cannot prove a safe state. Append a terminal audit event for every outcome.

- [x] **Step 4: Run duplicate, retry, crash-recovery, and fail-closed tests**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/live-execution.test.ts tests/reconciliation.test.ts tests/execution-repository.test.ts`

Expected: PASS; each proposed action maps to at most one external order.

- [x] **Step 5: Commit**

```sh
git add apps/desktop/src/main/execution apps/desktop/tests
git commit -m "feat: execute and reconcile live outbox"
```

### Task 8: Add dedicated Live Review and typed confirmation

**Files:**
- Create: `apps/desktop/src/renderer/screens/LiveReviewScreen.tsx`
- Modify: `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/tests/live-review.test.tsx`
- Modify: `e2e/desktop-smoke.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 6, and 7 renderer-safe APIs.
- Produces: connection, risk, preflight, deployment-summary, and typed-confirmation UI; `Run Paper instead`; persistent Stop.

- [x] **Step 1: Write failing Live gate tests**

```ts
expect(screen.getByRole('button', { name: 'Start Live' })).toBeDisabled();
await user.type(screen.getByLabelText('Type bot name to confirm'), bot.name);
expect(screen.getByRole('button', { name: 'Start Live' })).toBeEnabled();
expect(screen.getByRole('button', { name: 'Run Paper instead' })).toBeVisible();
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/live-review.test.tsx`

Expected: FAIL because the Live Review route is absent.

- [x] **Step 3: Implement the dedicated Kumo review page**

Render all five required sections, identify every failed check with repair navigation, require exact case-sensitive bot-name confirmation, display `Live` text plus a red risk icon, and never place a Live start action in a modal. Hide full account IDs and all credentials.

- [x] **Step 4: Run UI accessibility and packaged testnet E2E**

Run: `pnpm --filter @catbots/desktop test && pnpm test:e2e`

Expected: PASS; any failed preflight check keeps Live disabled and Paper remains available.

- [x] **Step 5: Commit**

```sh
git add apps/desktop/src/renderer apps/desktop/tests e2e
git commit -m "feat: add hyperliquid live safety review"
```

### Task 9: Complete M3 verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-05-catbots-m3-execution.md`
- Modify: `docs/superpowers/plans/2026-09-03-catbots-delivery-roadmap.md`

**Interfaces:**
- Consumes: all M3 tasks.
- Produces: repeatable operator instructions and checked acceptance evidence.

- [x] **Step 1: Run all release gates**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e && pnpm make`

Expected: all commands exit 0.

- [x] **Step 2: Run explicit M3 safety acceptance tests**

Run: `pnpm --filter @catbots/desktop exec vitest run tests/paper-deployment.test.ts tests/hyperliquid-adapter.test.ts tests/hyperliquid-preflight.test.ts tests/live-execution.test.ts tests/reconciliation.test.ts`

Expected: PASS for Paper parity, testnet normalization, Agent Wallet validation, audit-outage fail-closed behavior, and lost-response reconciliation.

- [x] **Step 3: Update operator documentation**

Document Paper start/stop, Hyperliquid testnet Agent/API Wallet setup, risk limits, Live Review, emergency Stop, trace inspection, and the explicit mainnet-disabled boundary. Include no credential examples that resemble usable secrets.

- [x] **Step 4: Mark checklist evidence only after reading fresh output**

Change each completed checkbox in this plan and M3 in the delivery roadmap only when its corresponding command has fresh exit code 0.

- [x] **Step 5: Commit**

```sh
git add README.md docs/superpowers/plans
git commit -m "docs: complete m3 execution acceptance"
```

## Self-review

- Spec coverage: deployment separation, adapter boundary, Paper/Live parity, audit ordering, transactional outbox, risk limits, idempotency, reconciliation, Live Review, Stop, and testnet-only gating each map to Tasks 1–9.
- Scope split: Tasks 1–5 form the independently releasable Paper/safety foundation; Tasks 6–9 add Hyperliquid testnet Live without enabling mainnet.
- Type consistency: `PerpDexAdapter`, `ExecutionRepository`, `DeploymentService`, `HyperliquidAdapter`, `OutboxExecutor`, and `ReconciliationService` are introduced before their consumers.
- Placeholder scan: the plan contains no deferred implementation markers; every task names exact outputs, tests, commands, and acceptance behavior.
