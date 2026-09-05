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

## Final fix wave continuation — review at `870a625`

This is the continuation of the same final fix wave, addressing the six follow-up findings against `870a6257671305d5f9107d3f57829be176573d36`. Work remains on the explicitly approved `main`; no subagents, remote mutations, dependency changes, or migration changes were needed.

### Finding-by-finding RED/GREEN evidence

1. **Actual submission-time rate enforcement.** A production Live-ingestion/outbox regression queues three historical $700 intents under a one-order/minute cap, then executes the delayed queue at the same actual time. RED: queued items submitted together. Claim now checks the durable cap in the same immediate transaction as the claim/submission audit, with actual claim/outcome times and no attempt/audit for throttled items. Pending rows advance in durable arrival order, not caller-supplied occurrence order. A strengthened backdated-arrival regression first failed because the third arrival jumped the queue; `rowid` FIFO now prevents that. Restart and one-minute advancement prove every item progresses exactly once. A separate unresolved-adapter regression was RED when a claim older than a minute allowed another submission; outstanding claims now keep their reservation, and the eventual receipt starts a conservative minute window. Final Live suite: 16/16.

2. **Collision-safe Trigger/parent identity and legacy retries.** Trigger identity now uses versioned, separately percent-encoded components; parent/effect components are also encoded independently, remain deployment-scoped, and exclude universe revision. RED unit/coordinator cases used colon-bearing Trigger/Event IDs that previously collapsed to the same identity. Both now produce distinct parent/child identities. A production repository/service regression records a legacy parent with public persistence APIs, refreshes the universe, and retries: RED produced a new parent and queued an order; GREEN returns the original durable parent, duplicate status, zero new outboxes, and unchanged first-universe evidence. Durable occurrence lookup is based on deployment, exact Trigger identity/kind, and occurrence, preserving old persisted IDs without rewriting them. Focused Trigger/coordinator/runtime verification: 38 tests.

3. **No-op Backtest equity peaks.** The regression opens a position, marks equity to $20,000 on a no-action frame, then reaches a $10,000 action frame with a 20% drawdown cap. RED filled the second action; GREEN rejects it and reports the same 50% drawdown. Replay records peaks after portfolio marks, funding accounting, and execution, and retains those peaks in the reported equity/contribution curves. The shared risk check and reported metric therefore use the same high-water mark. Backtest/simulator focused verification: 33 tests.

4. **Terminal partial fills and accurate reservations/lifecycle.** New SDK-facade → client → adapter → repository/reconciliation tests cover both partial cancellation and partial rejection, plus a synchronous IOC partial-cancel receipt. RED lost terminal partial outcomes and released all exposure. GREEN persists cumulative filled quantity, original quantity, and proven executed notional in distinct `execution.partially_filled_cancelled`/`execution.partially_filled_rejected` audit. A $500 intent with $200 filled retains exactly $200 exposure and releases only $300; incomplete value evidence conservatively retains intended notional. Filled exposure transfers to actual positions only with an explicitly trusted, valid post-outcome `positionsObservedAt` snapshot. Tests verify that callers without that evidence cannot silently drop the reservation. Two overlapping reconciliation passes initially failed on the second terminal write; terminal persistence is now idempotent across concurrency and restart. A mixed-action child remains open while another action is only acknowledged, then closes exactly once as `flow.failed` after the other action fills. Partial actions never emit `execution.filled` or `flow.completed`. Focused terminal-partial suite: 6/6.

5. **Bounded, isolated, identity-targeted reconciliation.** Main reconciliation prefers the adapter's optional direct unsettled-client-order lookup. Hyperliquid queries only those cloIDs, and both that path and the legacy fills-based fallback use at most four concurrent status requests. RED fallback lost all evidence when one of 250 lookups failed; GREEN preserves 249 independent results and observes the concurrency bound. A direct-path regression supplies 250 unrelated trade fragments but requests only two unsettled identities: exactly two status requests occur, and one failed request cannot erase the other confirmed result. A position-read failure likewise cannot discard independent order evidence. Malformed/unrelated fragments and provider errors remain isolated and unexposed.

6. **Close-percent projection parity.** The shared browser-safe Main/Preview/Paper projection now renders an omitted validated close percent as 100. RED returned empty Action detail; GREEN returns 100. Five explicit invalid-value cases still produce no percent and are not treated as omission. Focused shared projection: 6/6; Preview/IPC/Workbench integration checks remained green.

### Continuation commands and final verification

All Node commands used `PATH=/opt/homebrew/opt/node@22/bin:$PATH` (Node `v22.23.2`). Focused RED/GREEN commands included:

```sh
pnpm --filter @catbots/strategy-runtime exec vitest run src/triggers.test.ts src/evaluation-coordinator.test.ts src/runtime.test.ts
pnpm --filter @catbots/strategy-runtime exec vitest run src/backtest.test.ts src/simulated-adapter.test.ts
pnpm --filter @catbots/desktop exec vitest run tests/final-live-regressions.test.ts
pnpm --filter @catbots/desktop exec vitest run tests/terminal-partial-reconciliation.test.ts tests/hyperliquid-client.test.ts tests/reconciliation.test.ts tests/live-execution.test.ts
pnpm --filter @catbots/desktop exec vitest run tests/trace-projection.test.ts tests/web-preview-api.test.ts tests/ipc-security.test.ts tests/bot-workbench.test.tsx
```

The final candidate passed all required gates afresh; these counts supersede the earlier wave's totals above:

| Command/check | Result |
| --- | --- |
| `pnpm test` | **576 passed**: contracts 32, execution-core 21, strategy-runtime 135, desktop 388. 60 files passed; one optional LM Studio file/test skipped. |
| `pnpm typecheck` | All four workspace packages passed. |
| `pnpm test:e2e` | Production Electron package built; **4/4** Playwright tests passed: browser workflow, fresh install, durable Paper restart, native lifecycle. |
| `node -e "const db=require('better-sqlite3')(':memory:'); db.close(); console.log(process.version,process.versions.modules)"` in desktop | Post-package host SQLite open/close passed on Node v22.23.2, ABI 127. |
| `pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/market-universe-cache.test.ts tests/final-live-regressions.test.ts tests/terminal-partial-reconciliation.test.ts tests/trace-projection.test.ts` | Post-package **45/45**, five files passed. |
| `rg -n 'node:crypto\|createHash\|node:perf_hooks\|better-sqlite3\|__vite-browser-external' apps/desktop/.vite/renderer/main_window/assets` | No forbidden Node/native import matches (expected no-match exit 1). |
| `git diff 8eaf5c6ecd34194cc7d4a93ff9ebad6f3780c3f0 -- apps/desktop/src/main/storage/migrations.ts` | Empty diff: migrations 1–6 unchanged; no new migration. |
| `git diff --check` | Passed. |

All six continuation findings are addressed. Documentation now describes encoded identity compatibility, durable FIFO submission throttling, no-action peaks, terminal-partial accounting, and bounded reconciliation. The existing intentional deferral of unused `market.evaluation_started` remains unchanged. No new scheduler, autonomous retries, Paper ledger rehydration, mainnet support, or inferred venue fill evidence was added. Throttled pending items require the existing execution integration to retry; unknown outcomes remain unretried until proven. The TDD and verification skills drove production-path RED regressions and fresh final gates; no assertions were weakened and no unsafe production test seams were introduced.
