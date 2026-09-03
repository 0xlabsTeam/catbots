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

An initial direct Electron smoke launch exposed the host `better-sqlite3` ABI mismatch (Node ABI 147 versus Electron ABI 143). The package script now rebuilds for Electron and restores the host build afterwards; `node` can again open an in-memory SQLite database and the full unit suite passes.

Before the ABI correction, direct source-launch and Playwright runs either exited at database startup or hung before `app.whenReady()` in this host. The remaining packaging issue is distinct: Forge logs successful Vite compilation and `Finalizing package`, then returns no `Catbots.app` or ZIP. Because the app binary is absent, this host cannot complete the rendered First Launch E2E or the positive tray lifecycle run. The automated lifecycle test and guarded native E2E seam are present, but their positive browser execution remains unverified here; do not treat Task 8's tray-loop acceptance as proven by this report.
