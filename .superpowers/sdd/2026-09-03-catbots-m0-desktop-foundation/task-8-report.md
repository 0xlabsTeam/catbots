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

The positive close → tray → Open → Quit GUI loop could not run in this host. The correct, non-committed helper entry was created at `/private/tmp/catbots-runtime-probe.qVPSS8/probe-main.cjs` and invoked as an Electron app (rather than passing JavaScript as an app-path argument):

```sh
../../node_modules/.bin/electron --no-sandbox /private/tmp/catbots-runtime-probe.qVPSS8/probe-main.cjs /private/tmp/catbots-runtime-probe.qVPSS8/probe.sqlite
```

Its actual output was:

```text
/Users/artizno/0xlabs/catbots/.worktrees/catbots-m0/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron exited with signal SIGABRT
```

Therefore it did not run far enough to establish an Electron/SQLite result, and no positive SQLite probe is claimed. A permitted `pnpm dev` run did emit the runtime-worker, preload, and Main bundles, then took the safe startup-failure path and printed only `Catbots fatal startup error`. The native tray was consequently unavailable for a host GUI loop. No production data-directory injection was added; the helper is temporary and outside the repository.

The automated Main lifecycle tests cover the intended loop: renderer failure retains native runtime/tray resources and tray Open recreates the window; both renderer and tray Quit require a native Main-owned confirmation; confirmed Quit stops runtime, disposes IPC, closes the database, and then calls `app.quit()`.

## Fix round 1

- Renderer `loadURL` failure is now isolated from fatal native startup: it emits only `Catbots renderer unavailable`, destroys the failed window, retains tray/runtime, and lets Open create a new window.
- Both quit entrypoints call a renderer-independent native confirmation with fixed copy. Cancel leaves the app running; confirmation leads through the ordered shutdown path.
- A worker timeout now considers only `kill() === true` successful. `false` and thrown kills reject with `RUNTIME_STOP_FAILED`, report an error status, keep the worker guarded against stale events, and accept a later real exit as the evidence needed to reach `stopped`.
- Shutdown catches and reports fixed runtime/IPC/database cleanup failures while continuing the remaining stages and guaranteeing the final `app.quit()` call.

Corrected validation:

- Focused lifecycle/runtime tests: 105 passing.
- Full workspace tests: 3 contracts and 105 desktop tests passing.
- Workspace typecheck: passed.
- Dev worker build: `pnpm dev` emitted `apps/desktop/.vite/build/runtime-worker.js`; host startup then safely failed as described above.
- Hygiene: `git diff --check` passed.
