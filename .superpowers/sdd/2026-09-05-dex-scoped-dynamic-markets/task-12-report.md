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
