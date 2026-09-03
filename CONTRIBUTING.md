# Contributing to Catbots

## Setup and checks

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm make
```

Run the relevant focused test before changing behavior, then run the full checks before opening a contribution. The Electron E2E suite uses an isolated temporary data directory and must clean up its application process even when a test fails.

## M0 engineering boundaries

- Keep the renderer sandboxed: no Node integration, generic IPC, filesystem bridge, or remote renderer content.
- Add only named, typed preload methods backed by Main-process validation.
- The Settings form remains the only in-app writer of `local.env.yaml`; never log or commit credentials.
- Do not add a master wallet key. Hyperliquid Agent/API-wallet material is local configuration only.
- M0 has no cloud backend, telemetry, trading, Backtest, strategy execution, or Hyperliquid network calls.
- Preserve close-to-tray behavior; Main owns the native Quit confirmation and orderly runtime shutdown.

The package gate rejects `local.env.yaml`, its rollback copy, and `.superpowers` visual/planning artifacts.
