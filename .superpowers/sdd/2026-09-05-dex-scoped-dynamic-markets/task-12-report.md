# Task 12 implementation report

## Outcome

Implemented IPC, Web Preview, and end-to-end parity for the DEX-scoped dynamic-market desktop workflow on base `eb63446979da7db3d7fedf8872c070b1be675213`.

- Main validates the shared strict request schemas before every scoped repository or service call. Draft creation accepts only `{ name, dex }`; legacy `market` fields and fixed-market Backtest payloads are rejected before dependency access.
- Main independently validates Bot, Workbench, Backtest, Strategy revision, Live preflight, Paper, Live, active-deployment, runtime, and database response DTOs. Invalid dependency output becomes a fixed channel error instead of crossing into the renderer.
- Backtest trace details are projected at the Main boundary to a small semantic allowlist: condition result/reason/reference names, safe action configuration, and bounded risk rule IDs. Raw provider/universe payloads, dependency summaries, error text, idempotency keys, and secret-shaped fields are omitted.
- The preload bridge now exposes the exact shared `CreateDraftBotInput` and `LocalSettingsPatch` parameter types; Main keeps the runtime `unknown` trust boundary.
- Web Preview uses DEX Bot identity, Strategy schema 2.0 `dex_universe` scope, the ETH RSI entry/exit graph, record-version-2 dynamic Paper/Live deployments, BTC/ETH bundled coverage, aggregate plus per-market results, and one parent interval run with BTC and ETH child traces.
- Preview Backtests honor `all_available` and `include`. Filtering changes evaluated markets and child traces without narrowing the disclosed dataset coverage; an unsupported requested market fails explicitly.
- The Web Preview badge says `simulated data` and no longer presents a stale `temporary data` product banner. The bundled Backtest warning continues to state that its synthetic data is not live market data.
- Browser and packaged Electron E2E create a Bot with name plus DEX only. They assert no Market input, dynamic Workbench scope, BTC/ETH Backtest presentation, parent/child trace navigation, Paper review, and persisted DEX identity after restart.

No push, merge, publish, or subagent work was performed. The existing user-owned `pnpm dev:web` process was left running.

## TDD evidence

### IPC and preview RED

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/ipc-security.test.ts tests/web-preview-api.test.ts
```

Initial result: exit 1; 4 failures and 48 passes. Raw Bot and Backtest dependency objects crossed IPC unchanged, trace details retained provider/error payloads, and preview Backtests contained only BTC.

### Dynamic universe selection RED

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/web-preview-api.test.ts
```

Result: exit 1; 1 failure and 5 passes. An `include: ['ETH-PERP']` request incorrectly returned both BTC and ETH metrics/traces.

### Focused GREEN

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/web-preview-api.test.ts tests/ipc-security.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm exec playwright test e2e/web-preview-workflow.spec.ts
```

Results:

- IPC and preview: 2 files / 53 tests passed.
- Desktop typecheck passed.
- Web Preview E2E: 1 test passed.

## Full verification (Node 22.23.2)

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:e2e
```

Results before the final post-report rerun:

- Workspace tests passed: contracts 32, strategy runtime 126, execution core 21, desktop 343; one opt-in LM Studio test skipped.
- Workspace typecheck passed for contracts, strategy runtime, execution core, and desktop.
- E2E passed 4/4 after the repository orchestrator rebuilt the Electron ABI, packaged the app, and restored the host ABI. This covered Web Preview, fresh install, restart persistence, and native close/quit lifecycle.

The first broad run after the banner update correctly exposed one stale Task 12 assertion and was fixed. A later broad run encountered one unrelated Kumo Settings select timing failure; that suite passed 25/25 immediately in isolation, and the subsequent full workspace rerun passed.

## Process and ABI evidence

Before native E2E, process inspection found no running Catbots Electron application or `pnpm dev` Electron orchestrator. It found only the user's existing `pnpm --filter @catbots/desktop dev:web` Vite process. No process was killed. `pnpm test:e2e` invoked `scripts/package-desktop.mjs`, which owns Electron rebuild, Forge packaging, and host `better-sqlite3` ABI restoration.

## Changed files

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/main/ipc/register-ipc.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/web-preview-api.ts`
- `apps/desktop/tests/ipc-security.test.ts`
- `apps/desktop/tests/web-preview-api.test.ts`
- `apps/desktop/tests/bots-home.test.tsx`
- `e2e/web-preview-workflow.spec.ts`
- `e2e/desktop-smoke.spec.ts`
- `.superpowers/sdd/2026-09-05-dex-scoped-dynamic-markets/task-12-report.md`

## Concerns

- The Web Preview remains intentionally in-memory and synthetic; both the global preview badge and Backtest provenance/warning make that limitation explicit.
- The one transient Settings select failure did not reproduce in isolation or on the next full run. It is recorded above rather than attributed to Task 12.

## Fix Round 1 — 2026-09-05

### Outcome

- Web Preview now replays the canonical bundled coverage window (`2026-08-01` through `2026-09-01`) and the same point-in-time membership revisions as the real Workbench fixture: BTC alone on August 10, then BTC and ETH from the August 20 listing frame onward. Parent trace IDs use each fixture frame's observation time and universe revision rather than the request start.
- Preview range filtering is inclusive and honest. A request entirely outside coverage completes with no traces or trades, zero performance, and the real runner's `insufficient_history` and `missing_market_coverage` warnings. Dataset coverage remains the fixed source coverage rather than being rewritten to the request.
- Tests cover August 1–15 BTC-only evaluation with no ETH execution, an August 15–25 range crossing the ETH listing boundary, and January–February 2027 outside coverage.
- The preview assistant now describes the actual Strategy 2.0 graph: dynamic Hyperliquid scope, ETH-PERP guard, RSI 14 below 20 opening a long, RSI 14 above 80 closing that long, and no implicit short entry.
- The packaged restart test now creates a DEX-scoped Bot through the renderer, then uses the existing unsigned-test-only Main seam to save/validate a deterministic Strategy 2.0 revision, run the real bundled Backtest, approve the revision, start a record-v2 Paper deployment against a local fixed universe, and persist coordinated BTC/ETH audit events. Before and after relaunch with the same user-data directory, it verifies the approved revision, completed Backtest, running dynamic deployment, and identical audit log. Normal renderer IPC independently verifies persisted Workbench and active-deployment DTOs on both sides of the restart.
- The deterministic workflow does not call the configured LLM, Hyperliquid, or any external service. The setup/read surface is attached only when the pre-existing `e2eAllowed` gate validates test mode, a temporary E2E data directory, and an unsigned development build; it is not exposed through preload or production IPC.

### TDD evidence

Preview RED:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop test -- tests/web-preview-api.test.ts
```

Result: four new tests failed as expected. The old preview emitted ETH before listing, stamped traces at the request start, fabricated traces outside coverage, and described an unrelated ETF-flow strategy.

Packaged restart RED:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:e2e -- --grep 'approved dynamic Paper run'
```

Result: the new packaged test reached the existing test-only seam and failed because the deterministic workflow methods did not yet exist. During GREEN, the first focused packaged run then correctly caught a misaligned 08:15 fixture timestamp for an hourly UTC trigger; changing the fixture to 08:00 made the real trigger validator pass.

Focused GREEN:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/web-preview-api.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/ipc-security.test.ts tests/preload.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop package
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm exec playwright test e2e/desktop-smoke.spec.ts --grep 'approved dynamic Paper run'
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm exec playwright test e2e/web-preview-workflow.spec.ts
```

Results: preview 10/10, IPC security 47/47, packaged restart 1/1, and Web Preview E2E 1/1 passed.

### Full verification and native ABI

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:e2e
PATH=/opt/homebrew/opt/node@22/bin:$PATH node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 host ABI OK on', process.version)"
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts
git diff --check
```

Results:

- Workspace tests passed: contracts 32, strategy runtime 126, execution core 21, desktop 348; the opt-in LM Studio test remained skipped.
- Workspace typecheck passed.
- Packaged E2E passed 4/4, including Web Preview, fresh install, durable dynamic workflow restart, and native close/quit lifecycle.
- The repository packaging orchestrator rebuilt the Electron native module and restored the host binding. Direct Node 22.23.2 loading succeeded, and the post-package database suite passed 10/10.
- No Catbots Electron or `pnpm dev` process was running before the native suite. The user's existing Web Preview Vite process was left intact; no process was killed.
- `git diff --check` passed.

### Fix Round 1 concerns

- Paper adapter positions and orders remain runtime-owned and are not rehydrated after restart. This test therefore asserts durable deployment status and persisted audit events directly through the already-gated Main E2E seam; it does not claim that an interrupted Paper adapter resumes evaluation automatically.

## Fix Round 2 — 2026-09-05

### Outcome

- Web Preview now uses the same replay engine as the real Backtest workflow. The browser-safe replay core owns graph validation, point-in-time universe selection, position-aware evaluation, simulated execution, trade ledger construction, metrics, per-market results, and warnings. The Node Backtest wrapper retains artifact hashing and serialization.
- Preview trace outcomes and displayed trades are projected from replay audit events and the closed-trade ledger. They are no longer inferred from fixture revision names. In particular, an August 25–September 1 exit-only request has no inherited position, so both ETH actions are skipped, there are no executed child traces or trades, and return/trade metrics remain zero.
- Regression coverage now distinguishes three state histories: August 15–25 crosses the ETH listing and opens one position without a closed trade; August 25–September 1 contains an overbought frame but cannot close a nonexistent position; August 1–September 1 opens and closes one ETH long and reports matching execution traces, ledger timestamps, aggregate metrics, and ETH per-market metrics.
- The canonical bundled fixture is shared by Main and Preview, so membership revisions, RSI/price frames, timestamps, coverage, and limitations cannot drift between the two paths.
- Packaged E2E startup now chooses its deterministic local BTC/ETH market-universe adapter only after the existing security gate succeeds and the resolved application data directory exactly equals the requested dedicated E2E directory. The adapter is injected before cache initialization and periodic refresh begin, so the validated E2E path constructs no Hyperliquid public client and performs no Hyperliquid network request. Normal startup and a mismatched-directory attempt still construct the production Hyperliquid adapter/client.
- Durable restart snapshots now compare stable audit event IDs, trace IDs, sequence numbers, types, summaries, parent trace IDs, market, DEX, and universe revision. Volatile timestamps are intentionally excluded.
- Renderer trace projection remains allowlisted: only condition boolean/unknown results are exposed. Provider values, universe snapshots, execution idempotency keys, raw errors, and other runtime details remain inside the replay result.

### TDD evidence

Focused RED:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/web-preview-api.test.ts tests/main-lifecycle.test.ts
```

Result: 3 failures and 27 passes. The exit-only preview incorrectly reported a close as executed, preview summaries were hand-authored rather than ledger-consistent, and validated E2E startup constructed the Hyperliquid public client once.

Focused GREEN:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/web-preview-api.test.ts tests/main-lifecycle.test.ts tests/data-directory.test.ts tests/sample-backtest-data.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/strategy-runtime test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm exec playwright test e2e/web-preview-workflow.spec.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm exec playwright test e2e/desktop-smoke.spec.ts --grep 'approved dynamic Paper run'
```

Results: the four focused desktop suites passed 43/43; strategy runtime passed 126/126; Web Preview E2E passed 1/1; and the packaged durable-restart E2E passed 1/1.

### Full verification and native ABI

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:e2e
PATH=/opt/homebrew/opt/node@22/bin:$PATH node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 host ABI OK on', process.version)"
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/database.test.ts
git diff --check
```

Results:

- Workspace tests passed: contracts 32, strategy runtime 126, execution core 21, and desktop 353; the one opt-in LM Studio test remained skipped.
- Workspace typecheck passed.
- Packaged E2E passed 4/4: Web Preview, fresh install, durable dynamic Paper restart, and native close/quit lifecycle.
- The repository E2E orchestrator rebuilt the Electron native binding and restored the host ABI. Direct Node 22.23.2 loading succeeded, and the post-package database suite passed 10/10.
- Before E2E, process inspection found no Catbots Electron or Electron dev-orchestrator process. The user's existing Web Preview Vite process was left running; no process was killed.
- The built renderer contains no `node:crypto`, externalized Node shim, `createHash`, `node:perf_hooks`, or `better-sqlite3` reference. The browser build therefore consumes only the new replay subpath's platform-neutral graph/simulation dependencies.
- `git diff --check` passed.

### Fix Round 2 concerns

- `@catbots/strategy-runtime/backtest-replay` is one intentional new package subpath; the root package API was not widened. It accepts a caller-supplied identity-hash function and deliberately omits Node-only artifact hashing and serialization. The packaged renderer build and bundle scan verify that this subpath does not pull Node dependencies into the browser.
- Paper adapter positions and orders remain runtime-owned and are not rehydrated after restart, as noted in Fix Round 1. Durable deployment status and persisted audit identity/sequence are verified without claiming automatic continuation of an interrupted adapter.
