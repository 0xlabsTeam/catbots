# Catbots

Catbots is a local-first Electron desktop application. M0 provides the secure desktop foundation: local-profile onboarding, local Settings stored in `local.env.yaml`, local SQLite Draft Bot records, and a tray-managed runtime skeleton. It has no Catbots cloud account or telemetry.

## M0 boundary

M0 does **not** implement trading, Backtest, Strategy Runtime evaluation, or Hyperliquid execution. Provider credentials are local configuration only; no master wallet private key is accepted or stored.

The renderer is sandboxed and accesses native capabilities only through a small validated preload API. Secrets are transient during form entry, written only to the local configuration file, masked when read back, and must never be committed.

## Run locally

Install Node.js and pnpm, then:

```sh
pnpm install
pnpm dev
```

On first launch, create a Local Profile. Settings writes `local.env.yaml` inside Catbots' Electron data directory; use [local.env.example.yaml](local.env.example.yaml) only as a non-secret reference. Keep that data directory private and back it up according to your own local-security policy.

## Release gates

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm make
```

`pnpm test:e2e` uses an isolated temporary data directory. `pnpm make` creates the current-platform artifact beneath `apps/desktop/out/make` and checks that local configuration and planning artifacts are absent.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions and [SECURITY.md](SECURITY.md) for vulnerability reporting.
