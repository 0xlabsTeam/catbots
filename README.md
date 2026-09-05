<p align="center">
  <img src="apps/desktop/assets/icon.svg" width="112" alt="Catbots logo" />
</p>

<h1 align="center">Catbots</h1>

<p align="center">
  <strong>Describe a trading idea. See the logic. Backtest it. Run it.</strong>
</p>

Catbots is a local-first, macOS-only workbench for building auditable perpetual-DEX trading bots without writing code. A Bot belongs to one DEX—not one trading pair—so its Strategy can select a fixed symbol or screen the DEX's active perpetual markets as they change.

Catbots exists because generated trading code is difficult to inspect and trust. It turns a conversation into a constrained, versioned `Trigger → Condition → Action` graph, runs deterministic Backtests, applies shared portfolio risk limits, and records the execution trail before an order can reach Paper or Hyperliquid testnet.

> [!WARNING]
> Catbots is experimental trading software, not financial advice. Hyperliquid Live mode sends real orders to **testnet only**; mainnet is disabled. Backtest and Paper results do not predict future performance.

## Quick start — first Bot in under five minutes

Requirements: macOS, Node.js 22.x, pnpm 10.17.1, and an OpenAI-compatible or Anthropic-compatible LLM endpoint.

```sh
git clone https://github.com/0xlabsTeam/catbots.git
cd catbots
pnpm install
pnpm dev
```

In Catbots:

1. Create a **Local Profile**, enter the provider URL, API key, and model, then select **Connect & continue**.
2. Select **Create new bot**, enter a name, leave **DEX** set to **Hyperliquid**, and select **Create draft**. There is no pair selector.
3. In Chat, try: `Every hour, for ETH-PERP only, open a long when RSI 14 is below 20 and close that long when RSI is above 80. Backtest it.`
4. Inspect **Flow**, then **Backtest**. Review the declared dataset coverage and the **By market** results before approving the revision.
5. Select **Approve v…**, confirm approval, then select **Run Paper**. Review the DEX-wide scope and portfolio limits, start Paper, and inspect **Performance** and **Logs**.

Starting Paper or Live initializes the deployment and leaves it waiting. This release has no autonomous market-trigger ingestion or interval scheduler in the normal app, so starting by itself produces no evaluations, orders, or execution-log flow. A runtime integration must supply a Trigger and market context to the tested coordinator ingestion path described in [Dynamic markets](docs/dynamic-markets.md#deployment-start-and-trigger-ingestion).

The Workbench header should read `Hyperliquid · Dynamic markets`. See [Dynamic markets](docs/dynamic-markets.md) for the complete user workflow, safety rules, Backtest semantics, legacy compatibility, and recovery behavior.

## What you can build

- Fixed-symbol strategies use a normal Condition such as `market.symbol = ETH-PERP`.
- Screeners omit the symbol equality and filter each `currentMarket` by price, funding, volume, rank, or indicators.
- Interval Triggers evaluate the active DEX universe; market Events evaluate only their event market.
- Actions cannot choose a different symbol. Strategy 2.0 binds every Action to the evaluation's immutable `currentMarket`.
- “Sell ETH” means close or reduce an ETH Long. Opening a Short requires explicit short intent.

The graph always uses the same three node kinds:

```text
Trigger  →  Condition  →  Action
```

## Configuration

Settings is the only in-app writer of `local.env.yaml`, stored in the Catbots Electron data directory. Use [local.env.example.yaml](local.env.example.yaml) only as a field reference; never copy credentials into the repository.

For LM Studio, a typical OpenAI-compatible configuration is:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:1234/v1` |
| API key | `lm-studio`, or the token configured in LM Studio |
| Model | The loaded model identifier |
| Reasoning effort | `Off` for Qwen tool workflows |

With LM Studio running and a model loaded, run the optional real-model acceptance test with `pnpm test:lmstudio`. Override its defaults with `CATBOTS_LMSTUDIO_URL` and `CATBOTS_LMSTUDIO_MODEL`.

Hyperliquid testnet additionally requires the master account's public address and a dedicated Agent/API Wallet private key. Never give Catbots a master-wallet private key. Credentials remain in Electron Main and are excluded from renderer DTOs, Agent prompts, traces, logs, and diagnostics.

## Running Catbots

```sh
pnpm dev       # native Electron application
pnpm dev:web   # simulated browser preview
```

The browser preview uses in-memory fixtures, resets on reload, retains no API keys, and performs no YAML, SQLite, runtime, or exchange operations. Use the Electron application for persistence and native integration testing.

Paper simulates the selected DEX locally. Hyperliquid Live mode uses the approved Strategy 2.0 revision, a fresh market universe, explicit Live review, and the configured testnet Agent Wallet. Both modes use DEX-wide market access plus per-market and shared portfolio controls. Details are in [Dynamic markets](docs/dynamic-markets.md#paper-and-hyperliquid-testnet).

## Architecture and security

| Area | Responsibility |
| --- | --- |
| Electron Main | Configuration, SQLite, secure IPC, market-universe refresh, deployments, and exchange access |
| React renderer | Kumo UI, Chat, React Flow, Backtest results, deployment review, performance, and logs |
| `@catbots/contracts` | Strict renderer-safe DTOs and IPC schemas |
| `@catbots/strategy-runtime` | Versioned TCA graphs, deterministic evaluation, fan-out, Backtest, and traces |
| `@catbots/execution-core` | Venue-neutral adapter contract, risk checks, normalized orders, and idempotency |
| Hyperliquid adapter | Testnet metadata, Agent Wallet signing, submission, and reconciliation |

The renderer is sandboxed. Live proposals, approved risk decisions, and outbox items are written before adapter side effects. Unknown venue outcomes require reconciliation and are never blindly submitted twice. See [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## Contributing and verification

Use Node.js 22 and run the checks that cover your change, followed by the full gate:

```sh
pnpm test
pnpm typecheck
pnpm test:e2e
git diff --check
```

`pnpm test:e2e` packages the Electron application, manages the native `better-sqlite3` ABI through the repository orchestrator, and restores the host ABI afterward. Do not run a separate Electron development process at the same time.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the renderer/Main trust boundary, persistence, execution, or release packaging. The [dynamic-market design](docs/superpowers/specs/2026-09-05-dex-scoped-dynamic-markets-design.md) and [TCA product specification](docs/superpowers/specs/2026-09-03-tca-perp-bot-design.md) are the authoritative design references.

## Project status

Catbots currently includes the local desktop foundation, Chat-driven Strategy 2.0 workbench, deterministic multi-market Backtests, Paper execution, guarded Hyperliquid testnet execution, dynamic market-universe refresh, and durable per-market audit records. Windows, Linux, spot, options, cross-DEX routing, and mainnet execution are outside the current release.

No open-source license has been selected. Until one is added, copyright remains with the project owner and reuse terms are not granted automatically.
