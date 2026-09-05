# Task 9 implementation report

## Outcome

Implemented dynamic-market Agent and bundled Backtest semantics on base `f1266bc36cda844b4b8456681a41e50ca95008ce`.

- Agent tool dependencies now carry the Bot DEX and the bundled Backtest dataset catalog, with no fixed Bot market dependency.
- The Agent validation tool exposes and accepts only Strategy schema `2.0` with `marketScope: { type: "dex_universe" }` for new revisions.
- Stored Strategy `1.0` documents remain readable through repository-backed explanation/comparison paths. New Agent attempts to validate `1.0` are rejected.
- Direct Strategy 2.0 parsing replaces union parsing at the Agent creation boundary. Malformed documents now report concrete `schemaVersion`, `marketScope`, and nested field paths instead of collapsing to the old root-level union diagnostic.
- The system prompt requires `market.symbol` equality guards for named pairs, current-market screeners for broad requirements, Long-by-default buying, close/reduce semantics for ordinary selling, explicit intent before opening Short, and honest disclosure of Backtest coverage.
- The tool catalog exposes current-market symbol, price, funding, volume, rank, RSI, and the existing BTC ETF-flow fixture, together with the exact bundled dataset catalog.
- The Backtest tool now requires and forwards `marketUniverse` to the Task 5 `runBacktest` API.
- The bundled fixture declares fixed synthetic coverage for BTC-PERP and ETH-PERP from 2026-08-01 through 2026-09-01. Its first point-in-time universe contains BTC only; its later universe adds ETH.
- Workbench Backtests map Task 5 aggregate metrics, per-market metrics, dataset coverage, market-keyed trades, and child traces into the Task 1 summary contract. Trace lookup reads both the new coordinated artifact shape and the legacy array-of-events shape.

No push, merge, publish, or subagent work was performed.

## RED / GREEN evidence

### RED

Command:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/agent-tools.test.ts tests/agent-loop.test.ts tests/workbench-service.test.ts tests/sample-backtest-data.test.ts
```

Result: exit 1; 11 failures and 12 passes. Failures demonstrated the old Strategy 1.0 tool schema, root-level malformed-union diagnostic, missing market-relative catalog fields and coverage, fixed-market Backtest call, legacy-market Workbench dependency, single-market summary, absent listing boundary, and missing dynamic prompt rules.

### Slice GREEN

- Agent tools: 1 file / 10 tests passed.
- Agent loop: 1 file / 7 tests passed.
- Bundled sample adapter: 1 file / 2 tests passed.
- Workbench service: 1 file / 4 tests passed.
- Combined focused gate: 4 files / 23 tests passed.

### Required five-suite gate (Node 22.23.2)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/agent-tools.test.ts tests/agent-loop.test.ts tests/workbench-service.test.ts tests/sample-backtest-data.test.ts tests/lmstudio-workbench.e2e.test.ts
```

Result: 4 files passed, 1 file skipped; 23 tests passed, 1 test skipped. The real LM Studio suite remains opt-in through `CATBOTS_LMSTUDIO_E2E=1`.

### Broad verification (Node 22.23.2)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
git diff --check
```

Results:

- Desktop: 40 files passed, 1 skipped; 325 tests passed, 1 skipped.
- Workspace typecheck: contracts, strategy-runtime, execution-core, and desktop passed.
- Diff check: passed before report creation and will be rerun immediately before commit.

## Rulings and compatibility

- Strategy version strictness belongs at the Agent creation boundary. The repository and runtime retain the approved `1.0 | 2.0` union so historical revisions remain readable and replayable; `validate_strategy` uses `StrategyV2DocumentSchema` directly so the Agent cannot create a new v1 revision.
- Dataset coverage describes what the fixed fixture contains, not only what a particular request selects. Therefore summaries always report the catalog's BTC+ETH coverage, while Task 5 per-market metrics follow the requested `marketUniverse` selection.
- Fixture timestamps are fixed and filtered to the requested range. Requests outside the declared coverage remain honest through Task 5 missing-coverage/insufficient-history warnings rather than fabricating observations at arbitrary requested dates.
- Coordinated Backtest artifacts retain their parent/child trace identity. Workbench trace lookup also preserves legacy artifact readability because it still accepts the earlier array-of-events representation.

## Changed files

- `apps/desktop/src/main/agent/agent-tools.ts`
- `apps/desktop/src/main/agent/agent-loop.ts`
- `apps/desktop/src/main/workbench/workbench-service.ts`
- `apps/desktop/src/main/workbench/sample-backtest-data.ts`
- `apps/desktop/tests/agent-tools.test.ts`
- `apps/desktop/tests/agent-loop.test.ts`
- `apps/desktop/tests/workbench-service.test.ts`
- `apps/desktop/tests/sample-backtest-data.test.ts`
- `.superpowers/sdd/2026-09-05-dex-scoped-dynamic-markets/task-9-report.md`

## Concerns / follow-up

- No Task 9 blocker remains.
- The bundled dataset is intentionally small and synthetic. The prompt, tool catalog, summary coverage, and warnings all disclose that limitation.
- The real LM Studio behavior test was not enabled because the explicit environment flag was absent; its suite was discovered and skipped as designed.

## Fix Round 1 — compatibility, trace identity, Event scope, and runtime proof

Addressed all four review findings:

1. Strategy 1.0 Backtests now ignore a caller's dynamic universe selection and force Task 5's `include` mode to the trusted `legacy_market_hint` read from the Bot's stored identity. A missing binding fails closed with `LEGACY_STRATEGY_MARKET_MIGRATION_REQUIRED`. The regression proves a legacy BTC strategy produces no ETH trace or position even when the request asks for `all_available`.
2. Simulated fill ledger entries now retain their originating effect idempotency key and Action node ID. Backtest trade presentation resolves each filled close by that effect identity through its queued audit event instead of assigning trades to child traces by array index. A two-market, two-close-per-child regression proves all four trade trace IDs exist, match the trade market, and contain both actual close Actions.
3. Bundled Event inputs now follow the registered trigger scope. A DEX-scoped trigger produces one marketless Event whose single parent fans out to BTC and ETH; a market-scoped trigger continues to produce symbol-tagged occurrences. The DEX regression proves one parent and exactly one position per market.
4. The canned-provider Agent test is explicitly named as the FakeProvider interpretation contract. A separate deterministic Backtest test now proves the generated ETH RSI graph opens an ETH Long below RSI 20, excludes BTC, closes that Long above RSI 80, ends flat, and never proposes a Short opening. The sample dataset gained a post-listing ETH-overbought frame to make that behavior observable.

### Fix-round RED evidence

- Legacy binding seam: 2 failures / 4 passes. Strategy 1.0 replay included ETH and an unbound v1 revision completed instead of failing closed.
- Trade identity seam: 1 failure / 2 passes. The second BTC partial close was incorrectly assigned to the ETH child trace.
- Event scope seam: 1 failure / 3 passes. One DEX Event was emitted once per market, creating two parents.
- ETH runtime seam: 1 failure / 11 passes across sample and Agent-loop suites. No ETH trade occurred because the fixture lacked below-20 and above-80 post-listing frames.

### Fix-round GREEN verification (Node 22.23.2)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/agent-tools.test.ts tests/agent-loop.test.ts tests/workbench-service.test.ts tests/sample-backtest-data.test.ts tests/lmstudio-workbench.e2e.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/strategy-runtime test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
git diff --check
```

Results:

- Required five-suite gate: 4 files passed, 1 skipped; 28 tests passed, 1 LM Studio test skipped.
- Strategy runtime: 11 files / 126 tests passed.
- Full desktop: 40 files passed, 1 skipped; 330 tests passed, 1 skipped.
- Workspace typecheck: contracts, strategy-runtime, execution-core, and desktop passed.
- Diff check will be rerun on the final staged patch immediately before commit.

### Fix-round rulings and concerns

- The Bot's private migrated `legacy_market_hint` is the available trusted historical binding for Workbench and Agent-tool replay. The public Bot contract remains market-free, and no new Strategy 1.0 creation path was restored.
- A trusted legacy symbol absent from this deliberately limited dataset still fails through Task 5's explicit missing-coverage error. Only absence of the historical binding itself produces the migration-required error.
- Liquidations retain the existing synthetic fallback trade ID because they do not originate from a filled close Action. Every `execution.close_position` fill now resolves through effect identity without positional assumptions.
- No fix-round blocker remains. The opt-in LM Studio suite was not enabled.
