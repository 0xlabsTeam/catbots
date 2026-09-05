<p align="center">
  <img src="apps/desktop/assets/icon.png" width="128" alt="Catbots — AI trading bot flow logo" />
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
pnpm dev           # native Electron application
pnpm dev:desktop   # same as pnpm dev
pnpm dev:web       # real browser UI + local Electron backend, no window at startup
pnpm dev:all       # browser UI + desktop window, sharing one backend
pnpm dev:preview   # simulated UI only
```

Open **http://127.0.0.1:5180/** after the terminal prints `Catbots web:`. Real web mode uses the same AI provider, config, SQLite repositories, backtests and deployment services as desktop. Reloading the browser preserves saved bots and conversations. `dev:all` is the supported way to use both surfaces together; do not start separate backend processes against the same profile.

The browser talks to a loopback-only HTTP backend using an HttpOnly, SameSite session and same-origin requests. Provider credentials remain in the backend after entry. The backend currently runs on Electron/macOS; this is a real local web client, not a standalone static site or an Internet-hosted multi-user server. Keep the backend process running. Closing the browser does not quit the backend or stop its runtime; use the tray's Quit action or stop the dev process. Native quit confirmation and existing live-review requirements remain in place. Web mode is currently a development entry point, not a packaged web distribution. Port 5180 must be free; an occupied port fails startup instead of silently changing the browser origin.

`dev:preview` is separate: the browser preview uses in-memory fixtures, resets on reload, retains no API keys, and performs no YAML, SQLite, runtime, or exchange operations. Use the Electron application for persistence and native integration testing.

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

### Pi strategy agent

The shared web/desktop backend runs `@earendil-works/pi-agent-core` 0.84.3 and `@earendil-works/pi-ai` 0.84.4, matching [Cloudflare OS](https://github.com/cloudflare/cloudflare-os/tree/main/packages/workshop-backend). Pi owns the conversation loop, schema validation, sequential tool execution, and lifecycle events. Catbots supplies six strategy tools and the existing OpenAI-compatible/Anthropic-compatible HTTP transport, so saved provider settings (including LM Studio and reasoning effort) still apply. No separate Pi CLI installation or login is needed.

The agent can inspect nodes/data, validate drafts, backtest, explain, and compare versions. It cannot approve or deploy a strategy. A successful backtest stops further tools in that batch and ends the turn for review; at most eight tool rounds may execute. Cancellation and credential-safe failures propagate through the same backend to both clients.

The transport forwards live text deltas from OpenAI-compatible and Anthropic-compatible SSE responses through Pi to both web and desktop chat. Tool calls execute only after a complete, validated response; interrupted or truncated streams cannot execute partial tool arguments. Pi coding-agent shell/filesystem tools and usage/cost accounting are not enabled. Existing chat history and strategy storage remain compatible.

### Subscription providers (Pi)

Settings → AI providers supports ChatGPT Plus/Pro (Codex), Claude Pro/Max,
GitHub Copilot, xAI, OpenRouter, and Radius through Pi's provider-owned login
flows. Select **Sign in**, open the provider page, finish any device-code or
manual-code prompt, then choose a model and **Use for chat**. API-key login is
also offered where Pi supports it. Existing compatible API settings remain
available through **Use compatible API settings instead**. First-launch users
can connect and select a subscription model without creating API-key settings.

Web and desktop use the same local backend and credentials. OAuth tokens and
API keys stay in the profile's `provider-auth.enc`, encrypted using Electron
safeStorage; the file is user-only (0600). Catbots does not read or modify
`~/.pi/agent/auth.json`. Pi resolves and refreshes credentials under a serialized
store lock. Sign out deletes the local credential; it does not revoke a token
at the provider. OpenRouter keys can be revoked from the OpenRouter account.
The active provider/model is saved separately in `provider-selection.json`.

Claude subscription authentication draws on extra usage billed per token;
OpenRouter sign-in creates a key billed from OpenRouter credits. Provider terms,
account entitlements, and model availability still apply. Radius uses a dynamic
catalog: use **Refresh models** after connecting if necessary. Provider login
opens in the host's system browser, with Pi's loopback callback or manual input.
Actual account sign-in requires the account owner; automated tests use simulated
provider flows and do not prove subscription entitlement or live inference.

References: [Pi provider documentation](https://pi.dev/docs/latest/providers),
[Cloudflare OS provider routing](https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-backend/src/ai-models.ts).

### Community nodes

Open **Nodes** to inspect/install the Funding Filter starter or import a community
subflow manifest. The shared backend makes enabled definitions available to AI
chat. Saved revisions contain expanded built-in graphs and package version/hash
metadata, so package updates do not rewrite existing bots. Use archived versions
to roll back. See [Community Node SDK v1](docs/architecture/community-node-sdk.md)
for the authoring command, manifest format, limits and current scope.
