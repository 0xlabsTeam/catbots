# Task 8 report — supervised runtime and system tray

## Delivered

- Added an idempotent `RuntimeSupervisor` for one Electron utility-process worker. It publishes only legal M0 status transitions, ignores stale-worker events, supports status subscribers, sends `shutdown`, and escalates to `kill()` after a bounded timeout.
- Added an inert M0 utility worker. It only reports `ready` and exits for `shutdown`; it performs no strategy, Backtest, trading, Hyperliquid, or network work.
- Added a retained native tray with renderer-independent **Open Catbots** and **Quit Catbots** controls, plus a valid 16×16 PNG template asset.
- Main now recreates a destroyed window, keeps the process alive after closing windows, starts the worker once, and always stops the worker before IPC disposal, database shutdown, and `app.quit()`.
- Shared the `RuntimeStatusSchema` between contracts and validated Main IPC rather than keeping duplicate runtime-status validation.
- Added the worker Vite entry so `runtime-worker.ts` is emitted as `runtime-worker.js` for `utilityProcess.fork`.

## TDD evidence

1. `runtime-supervisor.test.ts` initially failed because `runtime-supervisor` did not exist.
2. The tray contract test then initially failed because `create-tray` did not exist.
3. The Main lifecycle tests were extended first and failed against the old Main composition (no tray, no recreation, no ordered shutdown).
4. The shared runtime-status contract test initially failed because `RuntimeStatusSchema` was absent.

## Validation

- Focused: `pnpm --filter @catbots/desktop test -- runtime-supervisor.test.ts main-lifecycle.test.ts` — 101 passing tests.
- Full: `pnpm test` — 3 contract tests and 101 desktop tests passing.
- Typecheck: `pnpm typecheck` — passed.
- Hygiene: `git diff --check` — passed.
- Worker build: `pnpm dev` emitted `apps/desktop/.vite/build/runtime-worker.js` alongside Main and preload bundles.
- Asset inspection: `sips` confirmed `apps/desktop/assets/trayTemplate.png` is a 16×16 PNG with alpha.

## Manual tray verification

The positive close → tray → Open → Quit GUI loop could not run in this host because its desktop sandbox denies the existing Electron `userData` directory at SQLite startup (`SQLITE_CANTOPEN`). The app reliably exercised the safe startup-failure path and emitted only the intended generic `Catbots fatal startup error`; no error detail or secret was logged. A direct elevated local SQLite probe opened the same database successfully, isolating this as a host-sandbox restriction rather than a Task 8 runtime/tray failure.

The automated Main lifecycle test covers the intended loop: close retains the process, tray Open recreates a destroyed window, and tray Quit awaits runtime stop before calling `app.quit()`.
