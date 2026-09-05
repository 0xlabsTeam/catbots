# Final fix report

## Final fix wave

Base: `8eaf5c6ecd34194cc7d4a93ff9ebad6f3780c3f0`, on the explicitly approved `main` branch. This is the single whole-branch fix wave requested after final review. No subagents, push, merge, publication, or migration changes were performed.

### Finding-by-finding evidence

1. **Legacy Backtest projection.** A production regression creates a version-3 database with an old saved Backtest and trace artifact, migrates, then calls Workbench `getState`/`getTrace`. RED: the new required summary fields caused schema failure. The repository now strictly recognizes the old summary shape and projects it without updating persisted JSON or artifacts. Unrecorded coverage/realized PnL are null, per-market attribution is empty, parent linkage is null, and ending equity is derived only from a saved equity point. The test verifies the original summary and artifact bytes remain unchanged. Initial focused GREEN: database + Workbench repository/service, 25 tests.

2. **Stable Trigger deduplication.** Parent identity now includes deployment, Strategy identity/version, Trigger and occurrence, with universe revision kept as structured evidence rather than identity. The revised coordinator regression and production Live-ingestion regression retry an occurrence after the revision changes and a market is listed: same parent, duplicate result, one outbox item, first universe retained. Cross-deployment identity remains distinct. Existing assertions that intentionally expected a changed identity were corrected to assert stable identity plus distinct evidence; no execution-count assertions were removed.

3. **Durable Live reservations.** The RED production test queued three $700 requests across ingestion calls/restart despite a $1,000 total-exposure limit. An immediate SQLite transaction now reads unsettled outbox exposure and order-time reservations, runs risk, and persists the coordinated result atomically. Pending, claimed, unknown, and acknowledged-but-unfilled opens reserve exposure; rejected or confirmed-filled actions release it. The final regression suite also proves claimed/unknown/acknowledged retention, rejected exposure release with the minute-rate reservation retained, and no double reservation when a confirmed fill appears in the trusted account. Existing forced-persistence-failure tests still verify rollback and no partial outbox.

4. **Held inactive reductions.** RED: inactive held markets had no child evaluation, so close flows could never reach risk in Paper or Live. The coordinator now includes a held inactive market only when the Trigger owns a close flow. Actual risk must still prove the reduction, and increases remain rejected. Paper supplies its known positions; Live supplies the trusted account state. Live refresh failure retains the last trusted snapshot solely for safe reducing paths and fail-closes increases. The production universe cache already retains removed-market tombstones. Paper open → inactive close/increase and Live inactive/offline-close regressions pass; a separate Live stale-increase test verifies `market-metadata-stale` rejection. Initial Paper/Live focused GREEN: 17 tests.

5. **Version-1 position predicate.** RED: a version-1 explicit BTC predicate evaluated ETH context rather than its configured market. The evaluator again honors `config.market` for version 1, while version 2 uses `currentMarket`. Strategy 2.0 schema rejects a version-1 position predicate or an explicit market override. The multi-market Backtest fixture now explicitly uses Strategy 2.0 and position-predicate version 2; independent PnL assertions remain intact. Initial focused evaluator/schema/runtime GREEN: 53 tests.

6. **Funding occurrence identity.** RED: adding a same-timestamp no-op flow doubled a $1.10 funding charge to $2.20. The simulator now applies funding once per market/timestamp, including recording a zero-holding occurrence, and rejects conflicting rates for that occurrence. The actual replay regression expects exactly $1.10 and one funding ledger entry.

7. **Historical Backtest risk.** RED regressions filled above historical maximum leverage and ignored explicit portfolio, order-size, and order-rate limits. Replay now invokes the shared Risk Engine before each simulated fill with historical metadata and shared marked portfolio/account/order state. Rejected actions produce honest `risk.rejected` audit without fills. Optional strict `assumptions.riskLimits` is wired through Main and Preview, with documented compatibility defaults for old requests. The fixed-market compatibility helper's synthetic metadata ceiling remains 50×; real dataset metadata is authoritative. A browser-safe execution-core risk-engine export avoids Node crypto. Initial Backtest/simulator focused GREEN: 32 tests.

8. **Default Live close percentage.** RED: a validated `execution.close_position` with `{}` produced no outbox action. Live normalization now explicitly defaults omitted percent to 100, matching Paper and Backtest. The production-ingestion test asserts one full-close intent.

9. **Live queue/acknowledgement/fill lifecycle.** RED: queue evidence was absent, acknowledgement prematurely completed the child, and an adapter final fill was not handled. Atomic proposal persistence now includes `execution.queued`. Acknowledgement remains unsettled; all action outboxes must be rejected or have confirmed fill evidence before terminal child audit is appended. Reconciliation includes acknowledged orders, is idempotent, and repairs crashes before terminal-trace closure. Final-fill adapter receipts persist `execution.filled` directly. An additional SDK-boundary RED test showed trade fragments were incorrectly labelled full fills; Hyperliquid now confirms terminal `orderStatus` before emitting `filled`. Mixed-action risk failures and multi-action child terminal assertions remain covered. Initial six-suite lifecycle GREEN: 34 tests; subsequent client + final-Live GREEN: 14 tests before reservation extensions.

10. **Durable Paper recovery view.** RED: a new service instance threw because the adapter was absent. `getPaperDeployment` now returns durable deployment/audit with `state: null` when the in-memory ledger is unavailable. The Workbench shows recovery truthfully, makes no position/order rehydration claim, and preserves Stop. Service restart and UI recovery tests verify logs remain identical and Stop persists a stopped deployment. Initial Paper + Workbench GREEN: 20 tests.

11. **Market-aware Paper Logs.** RED: Logs lacked the Trigger-parent controls and market children. Paper Logs now reuse TraceTimeline hierarchy and bounded Condition/Action/risk/execution details. The renderer test expands an interval parent then ETH and checks universe, predicate reason/result, side/size/leverage, approval, and fill. Initial BacktestPanel + Workbench GREEN: 14 tests.

12. **Preview detail parity (Minor).** RED: actual Preview replay returned condition result only and dropped reason/input/action details. Main, Preview, and Paper Logs now share a browser-safe allowlist projection. The Preview production-path regression checks bound Action and Condition evidence and absence of provider, integrity, and secret payload fields. Initial Preview + IPC-security + BacktestPanel GREEN: 65 tests.

### Commands and final verification

All Node-based commands used `PATH=/opt/homebrew/opt/node@22/bin:$PATH` (Node `v22.23.2`). Focused RED/GREEN commands included:

```sh
pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/workbench-repository.test.ts tests/workbench-service.test.ts
pnpm --filter @catbots/strategy-runtime exec vitest run src/condition-evaluator.test.ts src/strategy-schema.test.ts src/runtime.test.ts
pnpm --filter @catbots/strategy-runtime exec vitest run src/backtest.test.ts src/simulated-adapter.test.ts
pnpm --filter @catbots/desktop exec vitest run tests/final-live-regressions.test.ts tests/live-execution.test.ts tests/live-deployment-service.test.ts tests/execution-repository.test.ts tests/reconciliation.test.ts tests/hyperliquid-client.test.ts
pnpm --filter @catbots/desktop exec vitest run tests/paper-deployment.test.ts tests/bot-workbench.test.tsx
pnpm --filter @catbots/desktop exec vitest run tests/web-preview-api.test.ts tests/ipc-security.test.ts tests/backtest-panel.test.tsx
```

Final required gates:

| Command/check | Result |
| --- | --- |
| `pnpm test` | 557 passed: contracts 32, execution-core 21, strategy-runtime 132, desktop 372. 58 files passed; one optional LM Studio file/test skipped. |
| `pnpm typecheck` | All four workspace packages passed. |
| `pnpm test:e2e` | Production Electron package built; 4/4 Playwright tests passed (browser workflow, fresh install, durable Paper restart, native lifecycle). |
| `node -e "const db=require('better-sqlite3')(':memory:'); db.close(); console.log(process.version,process.versions.modules)"` | Post-package host binding loaded on Node v22.23.2, ABI 127. |
| `pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/market-universe-cache.test.ts tests/final-live-regressions.test.ts` | 3 files, 29 tests passed after packaging. |
| `rg -n 'node:crypto\|createHash\|node:perf_hooks\|better-sqlite3\|__vite-browser-external' apps/desktop/.vite/renderer/main_window/assets` | No forbidden Node/native import matches. |
| `git diff --exit-code 8eaf5c6ecd34194cc7d4a93ff9ebad6f3780c3f0 -- apps/desktop/src/main/storage/migrations.ts` | Unchanged: migrations 1–6 preserved; no new migration. |
| `git diff --check` | Passed. |

Dependency note: adding the runtime's two workspace dependencies required refreshing workspace links. Offline installation could not resolve the existing Git dependency tarball; normal `pnpm install --ignore-scripts` succeeded. The lockfile diff contains only the intended six workspace-link lines. Packaging restored the host native ABI successfully.

### Rulings and limitations

- All 11 Important findings and Preview parity are addressed. The unused `market.evaluation_started` event remains intentionally deferred; current context/flow audit already describes the evaluation lifecycle, and this wave does not introduce a redundant event.
- No new persisted schema was needed. Nullable renderer projection/recovery fields are explicit unavailable-state contracts, not invented runtime state.
- No autonomous Trigger scheduler, Paper ledger rehydration, mainnet support, or new market authority was introduced. A Live reduction still needs trusted positions and safe venue support; if that proof is unavailable it fails closed. Unproven venue outcomes remain unsettled and are never blindly resubmitted.
- Tests were added before the associated behavior changes and observed failing. Existing lifecycle fixtures were changed from acknowledgement to an explicit final fill only where they assert completion; multi-action completion, rollback, and independent PnL assertions remain enforced.
- TDD and verification skills drove the production-path regressions and fresh gates; the local-only finishing instruction preserves the existing workspace with no remote mutation.
