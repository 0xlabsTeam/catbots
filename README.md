# Catbots

Catbots is a local-first Electron desktop application. It includes local-profile onboarding, local Settings stored in `local.env.yaml`, local SQLite bot records, compatible LLM providers, a constrained strategy-design Agent, versioned Trigger–Condition–Action graphs, deterministic Backtests, React Flow visualization, and execution traces. It has no Catbots cloud account or telemetry.

The current release is macOS-only. The implementation keeps portable boundaries where practical, but Windows and Linux packages are not built, tested, or supported yet.

## Current safety boundary

The Strategy Runtime validates and evaluates versioned Trigger–Condition–Action JSON and runs deterministic local Backtests. AI strategy authoring, Backtests, Paper deployments, and guarded Hyperliquid testnet deployments are enabled. Hyperliquid mainnet is disabled. Catbots accepts only a dedicated Agent/API Wallet private key for Live signing; a master-wallet private key is rejected and must never be entered or stored.

The renderer is sandboxed and accesses native capabilities only through a small validated preload API. Secrets are transient during form entry, written only to the local configuration file, masked when read back, and must never be committed.

## Run locally

Install Node.js 22 and pnpm, then:

```sh
pnpm install
pnpm dev
```

On first launch, create a Local Profile. Settings writes `local.env.yaml` inside Catbots' Electron data directory; use [local.env.example.yaml](local.env.example.yaml) only as a non-secret reference. Keep that data directory private and back it up according to your own local-security policy.

### Web preview

To review the current UI in a browser without Electron, run:

```sh
pnpm dev:web
```

The browser preview uses a separate in-memory adapter. Provider connection tests are simulated, drafts and settings reset when the page reloads, API keys are not retained, and no YAML, SQLite, runtime, or exchange operation is performed. Use the Electron app for native integration testing.

## Strategy core

The pure `@catbots/strategy-runtime` workspace package can parse and validate canonical Strategy JSON and run a deterministic Backtest without Electron or network access:

```ts
import { runBacktest } from '@catbots/strategy-runtime';
import { btcEtfRsiBacktestRequest } from '@catbots/strategy-runtime/fixtures';

const result = runBacktest(btcEtfRsiBacktestRequest());
console.log(result.metrics, result.manifest.artifactHash);
```

The package records a complete audit trace for executed, skipped, unknown, rejected, and failed paths. Backtest output is historical simulation, not a promise of future returns.

## Paper and Hyperliquid testnet operator guide

Create a bot, describe its Trigger → Condition → Action rules in Chat, and let the Agent validate and Backtest the draft. Inspect the Flow, Backtest metrics, and trace, then select **Approve version**. Only an immutable approved revision can run.

For Paper mode, select **Run Paper** in the bot workbench. The default execution boundaries are a $1,000 maximum order, $2,500 maximum position, 3× maximum leverage, $300 maximum daily loss, 12% maximum drawdown, the bot's selected market, both long and short sides, and four orders per minute. Use **Pause** to suspend evaluation while retaining Paper state, or **Stop** to persistently terminate the deployment. Inspect **Performance** for equity, positions, fills, and audit-event count; inspect **Logs** for the ordered execution trace.

For Hyperliquid testnet Live mode:

1. In Hyperliquid testnet, authorize a dedicated Agent/API Wallet for the account that will trade. Keep the master-wallet key outside Catbots.
2. Open **Settings**, enable **Hyperliquid testnet**, enter the master account's public address and the dedicated Agent/API Wallet private key, test the LLM connection, and save. The Settings form is the only writer of `local.env.yaml`; stored secrets are returned to the renderer only as masks.
3. Backtest and approve the exact strategy revision, then select **Review Live**. Check the masked account, immutable revision, risk limits, data freshness, audit storage, runtime, reconciliation, and Agent Wallet authorization.
4. Resolve every failed check. Type the bot name exactly, including case, and select **Start Live**. Use **Run Paper instead** whenever you do not intend to submit testnet orders.
5. Use the persistent **Stop Live** control for an emergency stop and inspect the ordered audit log. An unknown venue response is not blindly retried; Catbots reconciles by deterministic client-order ID and suspends the deployment if it cannot prove a safe outcome.

Treat testnet funds and keys as sensitive. Backtests and Paper results do not predict Live performance, and the testnet gate must not be bypassed to reach mainnet.

## LM Studio integration test

Catbots supports LM Studio through its OpenAI-compatible endpoint. In Settings, use:

- Base URL: `http://127.0.0.1:1234/v1`
- API key: `lm-studio` (or the API token configured in LM Studio)
- Model: the identifier returned by LM Studio, for example `qwen/qwen3.8-27b`
- Reasoning effort: `Off` for Qwen tool workflows, so the output budget remains available for function calls

With LM Studio running and the model loaded, run the repeatable real-model acceptance test:

```sh
pnpm test:lmstudio
```

Override the defaults with `CATBOTS_LMSTUDIO_URL` and `CATBOTS_LMSTUDIO_MODEL`. The test creates an isolated in-memory bot, asks the real model to build a combined-condition strategy, validates it, runs a bundled-data Backtest, and requires a completed trade plus an executed trace. It never reads or changes the desktop profile database.

## Release gates

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm make
```

`pnpm test:e2e` uses a canonical dedicated child of the operating system temporary directory and only enables its native lifecycle seam for development or positively ad-hoc-signed macOS test builds. `pnpm make` fails outside Node.js 22 on macOS, creates the macOS artifact beneath `apps/desktop/out/make`, then inspects the app bundle, `app.asar`, and generated ZIP for local configuration, rollback, planning, review, and visual artifacts.

No license has been selected for Catbots yet; distribution terms remain pending an explicit project-owner decision.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions and [SECURITY.md](SECURITY.md) for vulnerability reporting.
