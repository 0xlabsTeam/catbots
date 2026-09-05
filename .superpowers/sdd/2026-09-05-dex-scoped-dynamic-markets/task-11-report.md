# Task 11 implementation report

## Outcome

Implemented the dynamic-market Workbench presentation on base `30c308302999fc6f6ea81e5fa304286e29c42517`.

- The Workbench header identifies `Hyperliquid · Dynamic markets`.
- React Flow remains limited to Trigger, Condition, and Action nodes. DEX and `All active perpetual markets` are presented in a compact metadata row outside the canvas.
- Backtest results now present aggregate portfolio performance first, explicit bundled-dataset market/date coverage, and a Kumo per-market table with realized PnL, trade count, win rate, and drawdown contribution.
- Execution traces are grouped by parent trigger run. Each run reveals its market children, strategy revision, and universe revision; selecting a market reveals categorized Condition, Action, Risk, Execution, Trigger, and Flow events.
- Trace navigation uses native Kumo buttons with `aria-expanded`, `aria-controls`, `aria-pressed`, and a named market-evaluation group. Collapsing or switching a parent invalidates stale asynchronous trace responses.
- Historical parent trace IDs remain readable: unknown trigger kinds are labeled conservatively as `Trigger run`, and unavailable universe revisions display `Not recorded` instead of being invented.
- Live review now states the DEX, all-active-perpetual market access, universe freshness, strategy revision, and all shared risk limits, including `maxTotalExposureUsd`, without showing a fixed market.
- Existing Kumo defaults and the current Catbots visual language were preserved. No theme tokens, gradients, Tailwind, PrimeVue, or new aesthetic system were added.

`BotWorkbenchScreen.tsx` already supplied the Task 11 portfolio default `maxTotalExposureUsd: '5000'` on this baseline, so it required no production change; its focused test continues to verify that value is sent to Paper deployment.

No push, merge, publish, or subagent work was performed.

## RED / GREEN evidence

### Scope and graph slice

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/bot-workbench.test.tsx tests/strategy-graph.test.tsx
```

Initial RED: exit 1; 2 failures and 6 passes. The Workbench lacked the dynamic scope line and the graph lacked the outside-canvas scope metadata.

Slice GREEN: 2 files passed; 8 tests passed.

### Backtest and parent/child trace slice

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/backtest-panel.test.tsx
```

Initial RED: exit 1; 2 failures. Aggregate/per-market/coverage headings and the parent interval-run drilldown were absent.

Follow-up RED cases captured a visible child detail after its parent was collapsed and an inaccurate interval label for an unrecognized historical parent ID.

Slice GREEN: 1 file passed; 3 tests passed.

### Live review slice

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/live-review.test.tsx
```

Initial RED: exit 1; 1 failure and 1 pass. DEX-wide access, universe freshness, and shared total exposure were not visible.

Slice GREEN: 1 file passed; 2 tests passed.

## Final verification (Node 22)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/bot-workbench.test.tsx tests/strategy-graph.test.tsx tests/backtest-panel.test.tsx tests/live-review.test.tsx tests/renderer-theme.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
```

Results:

- Focused UI plus renderer-theme gate: 5 files / 16 tests passed.
- Full desktop suite: 40 files passed, 1 skipped; 333 tests passed, 1 opt-in LM Studio test skipped.
- Workspace typecheck: contracts, strategy-runtime, execution-core, and desktop passed.

## Changed files

- `apps/desktop/src/renderer/workbench/WorkbenchHeader.tsx`
- `apps/desktop/src/renderer/workbench/StrategyGraph.tsx`
- `apps/desktop/src/renderer/workbench/BacktestPanel.tsx`
- `apps/desktop/src/renderer/workbench/TraceTimeline.tsx`
- `apps/desktop/src/renderer/screens/LiveReviewScreen.tsx`
- `apps/desktop/src/renderer/app.css`
- `apps/desktop/tests/bot-workbench.test.tsx`
- `apps/desktop/tests/strategy-graph.test.tsx`
- `apps/desktop/tests/backtest-panel.test.tsx`
- `apps/desktop/tests/live-review.test.tsx`
- `.superpowers/sdd/2026-09-05-dex-scoped-dynamic-markets/task-11-report.md`

## Compatibility and concerns

- No Task 11 blocker remains.
- The current renderer-safe trace DTO links child traces to a parent but does not expose `universeRevision` as a separate field. Coordinated trace IDs encode the revision deterministically, so the UI decodes that suffix and fails safely to `Not recorded` for historical/unknown IDs. A future contract revision may promote this metadata to an explicit field without changing the drilldown behavior.
- The bundled Backtest fixture remains intentionally small and synthetic; the UI shows its exact markets/date range and preserves its existing limitation warning.

## Fix Round 1 — truthful scope, trace evidence, and Paper review

Addressed all three P2 review findings and the related trace-selection race.

- The renderer-safe Workbench revision DTO now carries the strategy schema version and a discriminated market scope. Strategy 2.0 revisions project as the Hyperliquid DEX universe; Strategy 1.0 revisions remain fixed-market and include the trusted bot migration hint when it exists. Both the header and the graph metadata now avoid describing legacy revisions as dynamic.
- Trace detail renders only a small semantic allowlist from real audit-event shapes: condition result/reason/reference names, proposed action side/size/leverage, risk decision/rule IDs, and execution outcome. Values, provider payloads, error text, secret-shaped tokens, integrity data, IDs, and arbitrary JSON are never rendered. Each list is capped at three items and tokens at 80 characters.
- Changing bot, revision, or trace set resets the selected parent, market child, detail, and error. Request sequencing invalidates late responses after either a data change or navigation change.
- Paper execution now opens a Kumo review before making any deployment call. It states Hyperliquid, all-active-perpetual access, and the honest pre-start freshness state (`unavailable`), and exposes all editable shared risk limits including max total exposure. Cancel is mutation-free; confirmation submits the exact displayed limits.
- Live and Paper reuse the same deployment-scope summary. Account/preflight/explicit-confirmation safety remains confined to Live.
- The graph test fixture now verifies two predicate branches flowing into an explicit `combine.all` condition before the action, while the canvas still contains only Trigger, Condition, and Action node kinds.

### Fix-round RED / GREEN evidence

- Contract/repository/graph RED: the previous revision DTO rejected both `schemaVersion` and `marketScope`, and legacy scope could not be rendered truthfully. GREEN: contracts `9/9`; repository plus graph `11/11`.
- Trace RED: real condition/action/risk/execution event details produced no semantic evidence, and a pending old child request could survive a trace-set replacement. GREEN: Backtest/trace `4/4`.
- Paper RED: clicking `Run Paper` started immediately, so no review heading, scope, freshness state, editable limits, or cancel path existed. GREEN: Workbench `6/6`, including exact edited-limit submission.

### Fix-round final verification (Node 22)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/contracts exec vitest run src/workbench.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/workbench-repository.test.ts tests/workbench-service.test.ts tests/strategy-graph.test.tsx tests/backtest-panel.test.tsx tests/bot-workbench.test.tsx tests/live-review.test.tsx tests/renderer-theme.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
git diff --check
```

Results before the final post-report rerun:

- Contracts: 1 file / 9 tests passed.
- Focused repository, service, UI, and renderer-theme gate: 7 files / 32 tests passed.
- Full desktop suite: 40 files passed, 1 skipped; 336 tests passed, 1 opt-in LM Studio test skipped.
- Workspace typecheck: contracts, strategy-runtime, execution-core, and desktop passed.
- Diff whitespace check passed.

### Fix-round changed files

- `packages/contracts/src/workbench.ts`
- `packages/contracts/src/workbench.test.ts`
- `apps/desktop/src/main/workbench/workbench-repository.ts`
- `apps/desktop/src/renderer/web-preview-api.ts`
- `apps/desktop/src/renderer/workbench/DeploymentScopeSummary.tsx`
- `apps/desktop/src/renderer/workbench/StrategyGraph.tsx`
- `apps/desktop/src/renderer/workbench/TraceTimeline.tsx`
- `apps/desktop/src/renderer/workbench/WorkbenchHeader.tsx`
- `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- `apps/desktop/src/renderer/screens/LiveReviewScreen.tsx`
- `apps/desktop/src/renderer/screens/PaperReviewScreen.tsx`
- `apps/desktop/src/renderer/app.css`
- Focused contract, repository, graph, trace, Live review, and Workbench tests.

### Fix-round compatibility and concerns

- No Fix Round 1 blocker remains.
- A Strategy 1.0 revision without a trusted migrated market hint is labeled `Fixed market · unavailable`; it is never widened to dynamic scope.
- Paper cannot claim universe freshness before its runtime has started because the current review contract exposes no pre-start universe snapshot. The review says it is unavailable rather than inventing a fresh state.

## Fix Round 2 — Backtest identity, deployment eligibility, and shared risk validation

Addressed the three follow-up P2 findings.

- `TraceTimeline` now receives the selected Backtest ID as part of its reset identity. A distinct run clears expanded parent, selected market, detail, and error even if every trace summary field is identical, and the existing request sequence prevents late responses from repopulating the new run.
- Deployment review eligibility is now one shared predicate: the selected revision must be approved, Strategy schema 2.0, and DEX-universe scoped. Workbench Paper and Live actions are absent for approved Strategy 1.0 revisions, and the Paper start handler also enforces the predicate before IPC.
- Approved legacy revisions show concise upgrade guidance pointing back to the existing Chat → new revision → approval workflow. The truthful fixed market remains visible; all-active market access is never shown.
- Live review defensively skips preflight for ineligible revisions and presents the same upgrade boundary if invoked directly. The shared deployment scope summary now derives DEX and market access from the supplied bot and revision instead of hardcoding dynamic access.
- Paper risk validation now delegates the complete candidate to `RiskLimitsSchema`, retains the shared exact parsed object for submission, and layers only the portfolio ordering checks on top. Static field-safe messages avoid surfacing schema internals.
- Number controls match contract boundaries: leverage is an integer from 1–50, drawdown is positive and at most 100, and order rate is an integer from 1–600. Decimal USD amounts remain exact strings with arbitrary decimal steps. Invalid values display field feedback plus a safe summary, disable Start, and never reach IPC.

### Fix Round 2 RED / GREEN evidence

- Backtest identity RED: changing only `backtestId` left the previous parent expanded and allowed its state to remain. GREEN: Backtest/trace `5/5`, including rejection reset and a deferred response after two identical-summary run switches.
- Deployment eligibility RED: approved Strategy 1.0 exposed both deployment actions, and direct Live review preflighted and described all-active access. GREEN: Workbench plus Live review `10/10`; legacy scope is fixed-market and no deployment/preflight call occurs.
- Risk-boundary RED: the Paper form advertised leverage minimum 0 and accepted schema-invalid fractional leverage, drawdown above 100, and order rate above 600. GREEN: invalid examples `2.5`, `101`, and `601` are blocked; valid upper edges `50`, `100`, and `600` submit the exact full object.

### Fix Round 2 final verification (Node 22)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/contracts exec vitest run src/execution.test.ts src/workbench.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/workbench-repository.test.ts tests/workbench-service.test.ts tests/strategy-graph.test.tsx tests/backtest-panel.test.tsx tests/bot-workbench.test.tsx tests/live-review.test.tsx tests/renderer-theme.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
git diff --check
```

Results before the final post-report focused rerun:

- Contracts: 2 files / 20 tests passed.
- Focused repository, service, UI, and renderer-theme gate: 7 files / 35 tests passed.
- Full desktop suite: 40 files passed, 1 skipped; 339 tests passed, 1 opt-in LM Studio test skipped.
- Workspace typecheck: contracts, strategy-runtime, execution-core, and desktop passed.
- Diff whitespace check passed.

### Fix Round 2 changed files

- `apps/desktop/src/renderer/workbench/BacktestPanel.tsx`
- `apps/desktop/src/renderer/workbench/TraceTimeline.tsx`
- `apps/desktop/src/renderer/workbench/DeploymentScopeSummary.tsx`
- `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- `apps/desktop/src/renderer/screens/LiveReviewScreen.tsx`
- `apps/desktop/src/renderer/screens/PaperReviewScreen.tsx`
- `apps/desktop/src/renderer/app.css`
- `apps/desktop/tests/backtest-panel.test.tsx`
- `apps/desktop/tests/bot-workbench.test.tsx`
- `apps/desktop/tests/live-review.test.tsx`

### Fix Round 2 compatibility and concerns

- No Fix Round 2 blocker remains.
- Legacy running deployments retain their pause/stop or emergency-stop controls; the eligibility gate only prevents creating new deployments from legacy revisions.
- Paper freshness remains explicitly unavailable until the runtime starts because no pre-start universe snapshot is present in the renderer contract.
