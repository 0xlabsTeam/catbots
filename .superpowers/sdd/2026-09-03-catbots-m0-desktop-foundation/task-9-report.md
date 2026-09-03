# Task 9 report — desktop release gate

## Delivered

- Added a Playwright Electron smoke suite for First Launch plus the close-to-tray → reopen → cancel Quit → confirm Quit lifecycle.
- Added a test-only Main lifecycle seam. It is exposed only when `NODE_ENV === 'test'`, `CATBOTS_E2E_DATA_DIR` is set, and the app is not MAS production-signed. It is not available to the renderer or production processes.
- Added `resolveApplicationDataDirectory`, which accepts the E2E directory only in that guard and rejects relative, missing, symlinked, or non-canonical paths. The E2E suite creates an existing canonical directory under the OS temporary directory and closes Electron in `finally`.
- Corrected the development tray asset path and added a packaged extra resource for the tray template.
- Added Electron-native `better-sqlite3` rebuilding before package work and restores the host-Node native build after packaging so unit tests remain executable.
- Added package exclusion configuration and a package-content verifier for `local.env.yaml`, its rollback file, and `.superpowers` artifacts.
- Added local-first README, contribution guidance, private security-reporting instructions, non-secret YAML example, root release scripts, and ignored secret/test output paths.

## TDD evidence

`pnpm --filter @catbots/desktop test -- data-directory.test.ts` initially failed with `Cannot find module '../src/main/data-directory'`. After adding the resolver, the focused suite passed with 108 desktop tests.

## Validation

- `pnpm typecheck` — passed.
- `pnpm test` — passed: 3 contracts tests and 108 desktop tests.
- `git diff --check` — passed before the report was written.
- `pnpm test:e2e` — attempted after a Forge package build. It could not launch because Forge returned success after `Finalizing package` but left `apps/desktop/out` empty; Playwright correctly failed with `ENOENT` for the expected current-platform app binary. The suite is retained and does not skip this failure.
- `pnpm make` — attempted. Forge similarly returned after `Finalizing package` with no package or make artifact under `apps/desktop/out`; consequently there was no artifact to inspect or launch. No successful package-content or installer-launch claim is made.

## Environment findings and remaining acceptance

## Fix round 1 investigation

Node-version hypothesis confirmed: with a clean output directory and `PATH=/opt/homebrew/opt/node@22/bin:$PATH`, `node -v` reported `v22.23.2`; the identical package command exited 0 and generated `apps/desktop/out/@catbots-desktop-darwin-arm64/@catbots-desktop.app`, including `app.asar`. Node 26.7.0 reaches `Finalizing package` but produces no output. Forge 7/Electron packaging is therefore treated as Node-22-only for this repository. `engines` and a portable major-version guard now fail fast; no Homebrew path is committed.

Reproduction began from a removed `apps/desktop/out` and ran `pnpm --filter @catbots/desktop package`. Without escalation, Electron Packager failed while resolving GitHub; with escalation it reached `Finalizing package`, returned success, ran `postpackage`, and still left no `apps/desktop/out` directory. Forge's debug output proves the resolved output path is `/Users/artizno/0xlabs/catbots/.worktrees/catbots-m0/apps/desktop/out` and its resolved target is `darwin/arm64`.

The prior custom Vite ignore was not equivalent to the installed plugin default: `VitePlugin.resolveForgeConfig` has `if (!file) return false`, while the custom function returned `true` for `''`, excluding the package root. That root condition is corrected. This did **not** produce an artifact, establishing a distinct remaining component-boundary failure after Packager begins finalization. A temporary callback diagnostic did not receive any ignore-path calls before Forge returned, further indicating that failure is downstream or outside the ignore predicate.

The E2E source now uses real Node `ChildProcess` exit events, registers the replacement-window promise before asking Main to open it, removes the nonexistent `app.isQuiting` and `waitForEvent` calls, includes E2E sources in `tsc`, and removes its temporary directory if launch fails. Artifact discovery, hardened signing/data-directory guard, ABI isolation, archive inspection, and successful release-gate execution are not yet completed.

After Node 22 packaging, the source-entry E2E exposed the expected restored-host ABI boundary: Electron closed before First Window because the source launch loaded host-ABI SQLite. The suite now discovers the single outer app bundle from the package output instead of hardcoding a product/arch name; helper app bundles are excluded by limiting discovery to app bundles directly under the one-level Forge package directories. This last adjustment is unverified at report time.

Runtime-worker root cause fix: a dedicated `vite.runtime-worker.config.ts` now fixes the worker library output to `runtime-worker.js`; Forge's worker target uses it rather than sharing the Main config. The focused regression test was RED on missing config and GREEN after implementation (109 desktop tests). A Node 22 package then completed all Forge package stages successfully.

An initial direct Electron smoke launch exposed the host `better-sqlite3` ABI mismatch (Node ABI 147 versus Electron ABI 143). The package script now rebuilds for Electron and restores the host build afterwards; `node` can again open an in-memory SQLite database and the full unit suite passes.

Before the ABI correction, direct source-launch and Playwright runs either exited at database startup or hung before `app.whenReady()` in this host. The remaining packaging issue is distinct: Forge logs successful Vite compilation and `Finalizing package`, then returns no `Catbots.app` or ZIP. Because the app binary is absent, this host cannot complete the rendered First Launch E2E or the positive tray lifecycle run. The automated lifecycle test and guarded native E2E seam are present, but their positive browser execution remains unverified here; do not treat Task 8's tray-loop acceptance as proven by this report.

## Orchestrator signal and type boundary

The packaging module now has a narrow colocated TypeScript declaration rather than suppressing JavaScript-module errors. The declaration exposes only the command runner, child-process, signal-controller, and lifecycle seams; test callbacks are explicitly typed and `tsconfig` remains strict.

The runner now surfaces the actual spawned Forge child to a signal controller. On `SIGINT` or `SIGTERM`, the controller registers its exit wait before forwarding the signal, waits for that child to exit, restores the host ABI once, removes both listeners, and exits with 130 or 143. If restoration fails during interruption, it emits only the fixed safe diagnostic `Catbots host ABI restoration failed after interruption.` and exits nonzero. The focused injected-child test verifies this wiring; its fake child receives `SIGINT`, restoration does not begin until its exit event, and listeners are removed.

Validation under Node 22: `pnpm --filter @catbots/desktop test` passed (13 files, 118 tests) and `pnpm typecheck` passed. Package/direct-launch/E2E reruns remain next and are not claimed here.

## Final package and lifecycle evidence

The E2E data-directory and native lifecycle seam now share one centralized authorization result. It requires `NODE_ENV=test`, the explicit E2E data-dir variable, and a positive unsigned/development determination. Development default-app processes qualify; packaged macOS builds qualify only when `codesign` proves the exact executable is ad-hoc signed with no authority or team identifier. MAS, signed, and unproven packaged builds do not qualify. The supplied directory must be an existing canonical direct `catbots-e2e-*` child of `realpath(os.tmpdir())`; both root and child are checked with `lstat`, and configured application/user-data paths are rejected. The data-directory test suite covers allowed, disabled, relative, missing, symlinked, and non-dedicated paths, plus signing-state permutations (121 desktop tests).

Fresh Node 22 package evidence: Forge produced one current-host bundle under `apps/desktop/out/@catbots-desktop-darwin-arm64/@catbots-desktop.app`. Fresh ASAR extraction into a dedicated temporary inspector found `package.json` `main` exactly `.vite/build/main.js`; SHA-256 differs for main (`1abad390…`) and runtime worker (`00e03fb7…`), and their expected Main/`process.parentPort` signatures are present. The exact bundle executable was launched with an isolated temporary E2E directory and remained alive for eight seconds; it was then terminated before cleanup. `pnpm test:e2e` under Node 22 completed successfully with two Playwright tests after the hardened guard, covering First Launch and close-to-tray → reopen → Cancel Quit → confirmed Quit.

The package verifier now recursively checks visible bundles, every `app.asar` through `@electron/asar`, and every ZIP by extracting it into a fresh `catbots-package-inspect-*` temporary directory that is removed in `finally`. It rejects `local.env.yaml`, all `local.env.yaml.*` rollback/temp variants, `.superpowers`, and review/visual artifact names. Negative probes proved it rejects a forbidden ASAR entry and a forbidden ZIP entry. `pnpm make` under Node 22 succeeded, generated the darwin/arm64 ZIP under `apps/desktop/out/make`, and completed the deep verifier.

E2E cleanup now bounds Playwright close with a five-second process-exit wait. If Electron remains alive, it is force-terminated, awaited, and the test fails with an explicit error before the isolated data directory is removed. Typecheck and the two-test Node 22 Playwright run passed again after this safeguard.

## Fix round 2

E2E cleanup is now a separately tested helper. It preserves an `app.close` or forced-termination error, always removes the dedicated test data directory in `finally`, and raises an `AggregateError` if removal also fails. Focused tests prove both close-error and stuck-process paths remove data; the latter sends `SIGKILL`, awaits exit, then removes data before reporting failure.

The macOS signature inspection now invokes only `/usr/bin/codesign`, with an injectable command seam; the focused test proves a fake `PATH` command cannot be selected. Protected configured directories are `lstat`/`realpath` canonicalized and symlink aliases are rejected. Dedicated test directories require the `catbots-e2e-` name plus at least six alphanumeric random-suffix characters (the mkdtemp-compatible 35-bit minimum); static/weak suffixes are rejected. The guard test suite passed with 125 desktop tests.

Native ABI signal ownership now spans Electron rebuild, Forge, and host restoration. A single memoized restoration promise prevents duplicate rebuild/Forge/finally/signal restores. Signal handling registers child exit wait before forwarding, accepts already-exited children, waits for an in-progress restore, removes listeners, and preserves conventional 130/143 exits (or safe nonzero failure). Focused runner tests cover an already-exited child, interruption during rebuild, interruption during restore, duplicate signals, listener cleanup, and restore-once; full unit tests passed with 128 desktop tests.

`@electron/asar` is now a direct root dev dependency of the release-tooling owner, recorded in `pnpm-lock.yaml`; `pnpm exec node scripts/verify-package-contents.mjs apps/desktop/out` resolves it directly and passed. Controlled failure proof: `node scripts/package-desktop.mjs not-a-forge-command` failed at Forge as expected, then the Node 22 host successfully opened `better-sqlite3` and ran `SELECT 1`, proving ABI restoration. Final Node 22 `pnpm test:e2e` and `pnpm make` passed; make produced the darwin/arm64 ZIP and completed deep archive verification.
