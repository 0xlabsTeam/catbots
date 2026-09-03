# Catbots Delivery Roadmap

**Approved specs:**

- `docs/superpowers/specs/2026-09-03-tca-perp-bot-design.md`
- `docs/superpowers/specs/2026-09-03-catbots-desktop-ui-design.md`

## Why the delivery is split

Catbots contains independently reviewable desktop, strategy, AI, simulation, execution, and data subsystems. Building them in one implementation plan would defer integration feedback and make safety review ineffective. Each milestone below produces a working vertical increment and receives its own detailed plan before implementation.

## Milestones

### M0 — Desktop Foundation

Deliver an installable local-first Electron shell with secure process boundaries, Local Profile onboarding, Settings-managed `local.env.yaml`, embedded SQLite, Bots Home, and a supervised background-runtime/tray skeleton.

**Acceptance:** A fresh install can create a profile, configure and test a mock compatible LLM provider, restart without losing settings, create a local Draft Bot record, close to tray, reopen, and quit safely.

**Detailed plan:** `docs/superpowers/plans/2026-09-03-catbots-m0-desktop-foundation.md`

### M1 — TCA Strategy Core and Backtest

Deliver the versioned JSON schema, Node Registry, graph validator, Evaluation Context, three-valued Condition evaluator, event/interval runtime, deterministic simulation clock, Backtest adapter, metrics, and complete Backtest traces.

**Acceptance:** A fixture strategy using interval/event triggers, nested Conditions, indicators, and actions validates and produces deterministic Backtest results and reproducible audit traces.

### M2 — AI Bot Workbench

Deliver OpenAI-compatible and Anthropic-compatible provider adapters, the constrained Agent tool loop, versioned Chat-driven strategy changes, Backtest tool calls, read-only React Flow visualization, Inspector, Backtest UI, and explanation UX.

**Acceptance:** A user can describe a strategy in Chat, see a validated TCA graph, let the Agent run Backtest, inspect results/traces, and approve an immutable strategy version without viewing JSON.

### M3 — Paper and Hyperliquid Live Execution

Deliver Paper execution, the venue-neutral Perp DEX contract, Hyperliquid Agent Wallet integration, system Risk Engine, transactional outbox, idempotent execution, reconciliation, Live Review, persistent Stop controls, and full execution traces.

**Acceptance:** Paper and Hyperliquid testnet use the same Strategy Runtime; every triggered flow is auditable; failed audit/risk checks prevent external side effects; repeated events cannot duplicate orders.

### M4 — Performance, Data Catalog, and Release Hardening

Deliver Performance dashboards, cross-bot Activity, ETF Flow data contract/provider, Data Catalog, data freshness/entitlement UX, sleep/resume recovery, signed installers, migration/backup tooling, accessibility validation, and release documentation.

**Acceptance:** A packaged build can run and recover bots locally, display point-in-time performance and trace-linked events, consume the ETF Flow contract in Backtest/Live evaluation, and pass platform smoke/security checks.

## Sequencing rule

Milestones execute in order. M1 may define pure domain packages while M0 is in final UI review, but no Paper or Live side effect is enabled before M1 determinism and M3 audit/risk gates pass. Mainnet Live remains disabled until Hyperliquid testnet reconciliation and fail-closed tests pass.
