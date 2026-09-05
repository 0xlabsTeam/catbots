# Task 13 implementation report

## Outcome

Completed the DEX-scoped dynamic-market documentation and final acceptance coverage on base `e2d5896c9871036678d237432d6d1012f10b692f`.

- Reworked the README around what Catbots is, why its constrained workflow exists, and a first-Bot path that fits under five minutes. The README keeps setup, configuration, development, architecture, and contribution checks discoverable while routing detailed operating semantics to the dynamic-market guide.
- Added `docs/dynamic-markets.md` as the canonical guide for Bot/Strategy/market identity, fixed symbols and screeners, immutable `currentMarket` binding, point-in-time Backtest coverage and per-market results, Paper versus Hyperliquid testnet, listing and inactive-market handling, ordered audit evidence, legacy migration and repair, adapter extension, and typed data-product inputs.
- Added final migration assertions that a schema-v3 database becomes a Hyperliquid-scoped Bot while retaining its private legacy market hint, schema-1 Strategy document, and record-version-1 `marketBindings`; the legacy deployment remains readable and stoppable without a silent Strategy upgrade.
- Added a live-execution regression assertion that every normalized dynamic Action keeps the child trace's immutable market and that neither the trace nor Action contains secret-bearing fields.
- Strengthened packaged restart acceptance to require the ordered successful child evidence sequence from `trigger.received` through `flow.completed`, plus an explicit serialized-artifact secret scan.

No production runtime behavior was changed. No push, merge, publish, or subagent work was performed.

## TDD evidence

The new live-execution assertion was first forced to expect `ETH-PERP` while the actual immutable child market was `BTC-PERP`:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/live-execution.test.ts -t "keeps every dynamic action"
```

RED result: one expected failure, `expected 'BTC-PERP' to be 'ETH-PERP'`. Restoring the assertion to the persisted child context made the focused migration and execution suites pass:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts tests/live-execution.test.ts
```

GREEN result: 2 files / 16 tests passed. Desktop typecheck also passed.

## Automated E2E acceptance

The packaged Electron test independently exercises the unsigned-test-only deterministic workflow. It now verifies:

- a schema-2 approved `dex_universe` Strategy, BTC/ETH dataset coverage and child traces, and a record-version-2 running Paper deployment;
- durable revision, Backtest, deployment, and audit identity across an application restart;
- an ETH child trace containing, in order, `trigger.received`, `condition.evaluated`, `action.proposed`, `risk.approved`, `execution.queued`, `execution.filled`, and `flow.completed`;
- no configured sentinel, `agentPrivateKey`, `apiKey`, or `authorization` in the child trace or full durable snapshot.

Focused packaged acceptance passed 1/1 before the final broad run. The final E2E run passed 4/4: Web Preview, fresh install, durable dynamic Paper restart, and native close/quit lifecycle.

## Manual native-app acceptance

This was a separate `pnpm dev` smoke pass, not the packaged E2E test. It used Node 22, a dedicated canonical `catbots-e2e-*` temporary data directory, and a loopback-only scripted OpenAI-compatible provider.

Observed in the native UI:

1. **Create new bot** requested only Bot name and DEX; no market selector was present.
2. The created Workbench header read `Hyperliquid · Dynamic markets`.
3. Chat produced a visible Strategy flow with DEX scope, trigger, Conditions, and Actions.
4. Backtest displayed the bounded August 2026 sample-data provenance, `BTC-PERP, ETH-PERP` coverage, aggregate performance, **By market** results, trades, warnings, and parent/child execution traces.
5. `Approve v1` required confirmation. `Run Paper` showed DEX-wide scope and shared portfolio limits before starting.
6. Paper entered the running state. Logs correctly displayed `Waiting for the first trigger`; the desktop does not invent an autonomous trigger scheduler for this manual run.
7. After stopping Paper and relaunching with the same isolated directory, the Bot, approved Strategy v1, Backtest, stopped deployment state, and empty-ready Logs view were restored.

The first manual launch intentionally failed closed because its temporary-directory basename did not match the guarded `catbots-e2e-*` pattern. Repeating with a conforming canonical child succeeded. Catbots was then quit through its native confirmation, the watcher and loopback provider were stopped, and all isolated directories were moved to Trash. Process inspection found no remaining Catbots, Forge, packaging-orchestrator, or provider process. The existing user-owned Web Preview process was not touched.

The repository orchestrator restored native modules after both development and packaging. Direct Node 22.23.2 loading of `better-sqlite3` succeeded after cleanup.

## Full verification

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:e2e
git diff --check
```

Final results:

- Workspace unit/component tests: contracts 32, strategy runtime 126, execution core 21, desktop 354; one opt-in LM Studio test skipped.
- Workspace typecheck passed for all four checked packages.
- Packaged E2E passed 4/4.
- `git diff --check` passed.
- Local documentation links resolve.

The first broad run caught release-copy coverage requiring the literal `macOS-only`; the README was corrected. A later broad run exposed an invalid direct Paper IPC assertion in the packaged seam: Paper state is owned by a separately constructed deterministic service. The assertion was moved to the live-execution acceptance layer, while packaged E2E remains responsible for durable audit/persistence evidence. The final broad run above passed without retries.

## Audit scans and hit classification

Legacy-shape scan:

```sh
rg -n "state\.bot\.market|bot\.market|marketBindings: \[|allowedMarkets|Create a local draft with a name and market" packages apps/desktop/src e2e
```

There were no `state.bot.market`, `bot.market`, or obsolete create-copy hits. Every reported hit is an intentional record-version-1 compatibility surface:

- `packages/contracts/src/execution.ts`: `allowedMarkets` is the closed `LegacyRiskLimits` schema needed to parse durable v1 records.
- `packages/execution-core/src/risk-engine.ts`: detection and enforcement of a v1 deployment's immutable allowlist; dynamic record-v2 evaluation takes the separate DEX/current-market path.
- `packages/contracts/src/execution.test.ts`: legacy v1 fixtures plus negative assertions proving record-v2 deployments reject `marketBindings`.
- `packages/execution-core/src/risk-engine.test.ts`: a v1 fixture proving the compatibility risk path remains enforced.

Placeholder scan across the README, guide, and renderer found no `TODO`, `TBD`, deferred-implementation phrase, or speculative future-DEX copy.

The renderer secret-field name scan reported only two intentional categories: controlled credential-entry state/patch construction in `SettingsScreen.tsx`, and redacted masks in `web-preview-api.ts`. Neither Workbench nor execution renderer-safe contracts matched. A value-pattern scan across every Task 13 artifact and test found no key, private-key, authorization value, or token-like secret. Runtime assertions also scan the dynamic Action/trace and durable packaged snapshot.

## Rulings preserved

- Bot identity is `{ id, name, dex }`; market selection belongs to Strategy evaluation.
- Strategy 2.0 Actions are bound to immutable `currentMarket` and cannot override the symbol.
- “Sell” closes or reduces a Long unless the user explicitly asks to open or increase a Short.
- New listings join entry fan-out only after a successful refresh. Inactive markets reject new exposure but remain visible and may be closed only with proven reduce-only intent and sufficiently fresh evidence.
- Backtests use point-in-time dataset membership and shared portfolio state, and report both aggregate and per-market results.
- Mainnet remains disabled. Hyperliquid Live sends real API requests and orders only to the configured testnet account.
- Schema-1 Strategies and record-version-1 deployments remain readable/stoppable. Migration neither fabricates nor approves a Strategy 2.0 revision.
- Restart restores durable Bot, Strategy, Backtest, deployment, and audit records, but does not rehydrate Paper adapter positions/orders. A persisted Paper record is recovery state, not proof that local simulation automatically resumed.

## Changed files

- `README.md`
- `docs/dynamic-markets.md`
- `apps/desktop/tests/database.test.ts`
- `apps/desktop/tests/live-execution.test.ts`
- `e2e/desktop-smoke.spec.ts`
- `.superpowers/sdd/2026-09-05-dex-scoped-dynamic-markets/task-13-report.md`

## Concerns

- Manual Paper logs remain empty until an actual trigger is ingested; this is the expected no-autonomous-scheduler boundary and is stated rather than presented as an executed manual trade.
- Paper adapter positions and orders remain in-memory and are not rehydrated after restart. The guide and acceptance report explicitly distinguish durable record restoration from adapter continuation.
