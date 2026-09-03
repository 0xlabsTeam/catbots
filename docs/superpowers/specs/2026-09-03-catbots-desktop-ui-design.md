# Catbots Desktop UI/UX and Application Design

**Date:** 2026-09-03

**Status:** Approved in conversation

**Product:** Open-source, local-first desktop application for creating and running Perp DEX trading bots with an AI Agent

## 1. Product Experience

Catbots lets a trader who does not write code install a desktop app, create a local profile, connect an OpenAI-compatible or Anthropic-compatible LLM provider, and build a bot by chatting with an AI Agent. The Agent captures requirements, produces a versioned Trigger–Condition–Action Strategy Graph, validates it, and invokes Backtest. The user reviews the graph and results, then starts or stops Paper or Live execution.

The app remains running in the system tray when its window closes. Bots stop when the user quits Catbots, the machine shuts down, or runtime safety checks suspend execution. On wake or restart, Live bots reconcile exchange state before evaluating a new Action.

## 2. Experience Principles

1. **Conversation is the editor.** Users change strategies through AI Chat; JSON and graph wiring are not editable in MVP.
2. **The graph is the explanation.** React Flow presents the canonical TCA graph and the path taken during each evaluation.
3. **Paper first.** Paper is the default run mode. Live always uses a dedicated review checkpoint.
4. **Local and explicit.** Profiles, credentials, strategies, logs, and Backtests stay on the user's machine unless a configured provider call requires network access.
5. **Every decision is inspectable.** Performance points, orders, alerts, and skipped evaluations link to an execution trace.
6. **Safety is always visible.** Run mode, runtime health, risk utilization, and Stop are persistent while a bot runs.
7. **Complexity is progressive.** The first view explains outcomes; exact inputs, provider metadata, and adapter payloads are available on demand.

## 3. Visual Language

The approved direction is **Calm System**:

- follow the operating-system light/dark preference;
- use neutral surfaces with restrained borders and shadows;
- reserve orange for the primary action and active navigation;
- use green for healthy/success, amber for warning/unknown, and red for destructive/failed/live-risk states;
- prefer plain-language labels over protocol terminology;
- keep numerical columns tabular and right-aligned;
- avoid terminal styling as the default experience.

Cloudflare Kumo supplies application primitives, form controls, dialogs, menus, tooltips, tabs, tables, badges, and accessible interaction behavior. Catbots adds product-specific chart, graph, metric, trace, and trading components using Kumo tokens rather than a second design system.

References:

- [Cloudflare Kumo](https://github.com/cloudflare/kumo)
- [Kumo live documentation](https://kumo-ui.com)

## 4. Global Application Shell

The main window uses three regions:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Bot title · mode/status · strategy version            Backtest Run │
├────────┬─────────────────────────────────────────┬──────────────────┤
│ Global │ Workspace                               │ AI Chat          │
│ nav    │ Graph / Backtest / Performance / Logs   │ or Inspector     │
│        │                                         │                  │
├────────┴─────────────────────────────────────────┴──────────────────┤
│ Runtime state · last event · audit health · background status      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 Global navigation

- **Bots:** home, bot list, drafts, and workbench.
- **Data:** installed indicators and curated data products such as ETF Flow.
- **Activity:** cross-bot alerts, failures, executions, and trace search.
- **Settings:** local profile, AI providers, exchanges, storage, appearance, and diagnostics.

Navigation remains compact and icon-led, with accessible labels and tooltips. The current destination has both a color treatment and a non-color visual indicator.

### 4.2 Window behavior

- Target layout: at least 1180 CSS pixels wide for the full three-pane Workbench.
- At narrower widths, AI Chat/Inspector becomes a right-side drawer.
- Graph, tables, and logs preserve horizontal space before hiding secondary labels.
- Closing the last window hides Catbots to the system tray while bots are active.
- Choosing Quit with active bots opens a confirmation listing affected bots.

## 5. Installation and First Launch

Catbots ships as platform installers generated from the open-source repository. The first launch is a two-step setup, not a cloud registration flow.

### 5.1 Local Profile

Fields:

- profile display name;
- local data directory, prefilled with an application-specific directory;
- anonymous telemetry toggle, default Off.

The app verifies that the directory is writable and has adequate free space before continuing. A profile is local metadata and has no password or remote identity.

### 5.2 Connect AI Provider

Fields:

- protocol: `openai-compatible` or `anthropic-compatible`;
- provider display name;
- HTTPS base URL, or loopback HTTP for a provider running on the same machine;
- API key;
- model identifier;
- optional request headers in Advanced settings.

`Test connection` validates URL policy, authentication, model availability, and a minimal completion request. A successful test is required before the primary Create Bot flow, but the user may return to setup later if offline.

## 6. Local Configuration

The Settings Form is the only in-app editor for local configuration in MVP. It validates values and writes `local.env.yaml` atomically. A link reveals the containing folder; Catbots does not include a raw YAML editor.

Example shape:

```yaml
profile:
  name: My Trading
  telemetry: false

llm:
  provider: openai-compatible
  base_url: https://api.example.com/v1
  api_key: replace-me
  model: provider/model

exchanges:
  hyperliquid:
    network: testnet
    account_address: "0x..."
    agent_private_key: replace-me
```

Rules:

- store the file inside the selected Catbots data directory;
- exclude it from source control and export bundles by default;
- restrict file permissions to the current user where the operating system permits;
- write to a sibling temporary file, fsync, and atomically replace the previous file;
- preserve a single rollback copy after a successful write;
- never render complete secrets after initial entry;
- keep secrets only in the transient password input until submission; never persist them in renderer stores, snapshots, analytics, logs, crash reports, or LLM prompts;
- expose only a Hyperliquid Agent/API Wallet credential field and no master-wallet-key field; Live preflight later verifies that the derived signer is an approved Agent wallet;
- fail startup validation with a guided Settings repair screen when YAML is malformed.

Plain YAML secret storage is an explicit MVP trade-off. A later migration to OS-backed secret storage must preserve the same Settings interface and config references.

## 7. Bots Home

The Home screen answers three questions immediately: what is running, how is it performing, and what needs attention.

Primary content:

- `Create new bot` primary action;
- Running, Paper, Live, Paused, Stopped, Draft, and Error filters;
- summary cards for active bots, aggregate PnL, and unresolved alerts;
- bot rows/cards showing name, market, mode, status, PnL, drawdown, last event, and quick Stop;
- empty state that starts the Create Bot conversation.

Live status uses both the word `Live` and a red risk indicator. Paper uses a distinct neutral/green badge; color alone never communicates mode.

## 8. Create Bot and AI Workbench

Creating a bot asks only for a bot name and initial market. Exchange connection is not required for Draft, Backtest, or Paper mode.

The Agent then gathers requirements conversationally, one decision at a time:

1. trading goal and market;
2. interval or event trigger;
3. entry and exit conditions;
4. position sizing and strategy-level protections;
5. Backtest range and assumptions.

The Agent creates a new immutable draft revision after every accepted structural change. It calls Strategy Validation before updating the graph and calls Backtest only when the graph is valid.

### 8.1 Workbench center tabs

- **Graph:** canonical read-only TCA graph.
- **Backtest:** run configuration, progress, metrics, equity curve, trades, and assumptions.
- **Performance:** Paper/Live results and positions.
- **Logs:** execution traces and diagnostics.

During Draft, Graph is the default tab. During a Backtest run, Backtest becomes active. While a bot is running, Performance is the default when reopened. User-selected tabs are otherwise preserved.

### 8.2 Right rail

The approved right rail has two mutually exclusive tabs:

- **AI Chat:** strategy discussion, tool progress, explanations, and suggested changes.
- **Inspector:** selected React Flow node or trace-event details.

Selecting a graph node reveals an unobtrusive Inspector badge but does not forcibly switch away from an in-progress Chat response. When the Agent is idle, selecting a node opens Inspector immediately. Returning to Chat preserves scroll and draft input.

## 9. React Flow Graph

The graph renderer uses `@xyflow/react`. React Flow is a visualization dependency; it is not the Strategy Runtime and never mutates canonical strategy semantics.

Configuration contract:

- `nodesDraggable={false}`;
- `nodesConnectable={false}`;
- `elementsSelectable={true}`;
- pan, zoom, keyboard focus, fit view, Controls, Background, and MiniMap enabled;
- automatic left-to-right layout computed from canonical graph connectivity;
- layout positions stored as local UI preferences, not in Strategy JSON;
- custom node components for Trigger, Predicate Condition, Combined Condition, and Action;
- custom edges for active, inactive, unknown, rejected, and failed paths.

Node presentation:

- Trigger: purple top/left accent and clock/event icon.
- Condition: amber accent, plain-language predicate, current result, and data freshness.
- Combined Condition: grouped `ALL`, `ANY`, `NOT`, or `AT LEAST` summary with child count.
- Action: green for eligible Paper actions; neutral until evaluated; red is reserved for failures or destructive controls.

Clicking a node opens Inspector with configuration, plain-language explanation, source data, last result, and related trace events. During trace replay, the graph highlights the exact evaluated path and shows why a branch returned true, false, or unknown.

References:

- [React Flow quick start](https://reactflow.dev/learn)
- [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes)
- [ReactFlow component API](https://reactflow.dev/api-reference/react-flow)

## 10. Backtest Experience

Backtest is an Agent Tool and a visible user workflow.

The tab contains:

- date range, starting capital, fee/slippage model, and data availability summary;
- progress state with current phase and cancellable run;
- return, maximum drawdown, Sharpe-like risk metric, win rate, trade count, fees, and funding;
- equity curve with benchmark;
- trades table linked to trace details;
- warnings for insufficient history, sparse external data, and possible overfitting;
- a pinned assumptions panel.

Every Agent interpretation clearly separates observed Backtest results from suggestions. No result is described as a promise of future return.

## 11. Run Controls

The top-bar `Run` menu offers Paper and Live.

### 11.1 Paper

Paper is the default and requires a valid Strategy, available market data, writable audit storage, and user confirmation. It does not require Hyperliquid credentials.

### 11.2 Live Money Safety Gate

Live uses the approved dedicated Review page, never a lightweight confirmation modal.

The page contains:

1. **Connection:** network, masked account, Agent wallet state, account balance, and API test.
2. **Hard risk limits:** maximum order/position size, leverage, daily loss, drawdown, allowed markets, and execution frequency.
3. **Preflight:** Strategy validation, recent Backtest, data freshness, audit writability, runtime health, and open-position reconciliation.
4. **Deployment summary:** bot, immutable strategy version, market, interval/events, data products, and network.
5. **Typed confirmation:** exact bot name required before the enabled Live button.

The secondary action `Run Paper instead` remains visible. A failed preflight item links directly to its repair location and keeps Live disabled.

## 12. Running Bot and Performance

The running Workbench defaults to Performance and displays:

- mode and runtime status;
- total and unrealized PnL;
- maximum drawdown and risk utilization;
- current positions, leverage, entry, mark, stop, take-profit, and liquidation distance;
- equity curve and optional market benchmark;
- recent execution traces with Filled, Rejected, Skipped, Unknown, and Failed outcomes;
- last event time and audit-log health;
- persistent Stop Bot control.

Clicking a performance point, position change, order, or trace opens the corresponding Trace Detail. AI Chat may answer questions using selected trace data after showing the user exactly which trace will be shared with the configured LLM provider.

## 13. Execution Trace Detail

Trace Detail is a chronological, append-only explanation:

```text
Trigger received
→ Evaluation Context resolved
→ Predicate results
→ Combined Condition result
→ Action proposed
→ Risk approved or rejected
→ Execution queued and submitted
→ Acknowledged, filled, cancelled, rejected, or failed
→ Flow completed, skipped, or failed
```

Summary mode shows plain language. Technical details disclose timestamps, strategy/node versions, data provider and freshness, value hashes, normalized order intent, risk rule IDs, retry count, and sanitized adapter response. Secrets are never displayable.

## 14. Data Catalog

The Data screen shows built-in indicators and curated data products. Each product includes:

- description and normalized fields;
- live and historical availability;
- update cadence and freshness contract;
- provider and local cache state;
- Bot dependencies;
- connection or entitlement status.

The MVP ETF Flow product can be inspected and used by the Agent, but the marketplace has no third-party seller, payment, or publishing UI.

## 15. Activity and Notifications

Activity aggregates events across bots with filters for severity, bot, mode, market, and time. Critical local notifications include Live start/stop, risk suspension, execution failure, stale required data, disconnected runtime, and reconciliation failure.

Desktop notifications contain no secrets or complete account addresses. Clicking a notification opens the relevant Bot and trace. Notification permissions are requested only when the user enables notifications in Settings.

## 16. System Tray

The tray menu shows:

- runtime health and number of active Paper/Live bots;
- each active bot with mode and concise status;
- Open Catbots;
- Pause all bots;
- Stop all Live bots;
- Quit Catbots.

Destructive tray actions require confirmation in the main window when available. Emergency Stop remains available if the renderer is unhealthy through a native confirmation owned by the Electron main process.

Reference: [Electron Tray](https://www.electronjs.org/docs/latest/api/tray/)

## 17. Desktop Process Architecture

```text
Electron Main Process
├── window and tray lifecycle
├── local config and filesystem
├── typed IPC authorization
└── runtime supervisor
        │
        ├── Strategy Runtime Utility Process
        │   ├── scheduler and event ingestion
        │   ├── data resolution and conditions
        │   ├── risk engine and audit outbox
        │   └── execution adapters
        │
        └── Backtest Utility Process
            ├── historical event replay
            └── simulated execution

Sandboxed Renderer
├── React + Kumo application UI
├── @xyflow/react visualization
└── typed preload API only
```

The renderer has `nodeIntegration` disabled, context isolation and sandboxing enabled, a restrictive Content Security Policy, no arbitrary navigation, and no raw IPC primitive. The preload exposes narrowly scoped, typed methods whose arguments are validated again in the main process. Remote provider content is handled as data and never rendered as executable HTML.

Long-running strategy evaluation and Backtest work execute outside the renderer. The Electron main process supervises utility processes, owns the tray, and publishes sanitized status updates to the UI.

References:

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

## 18. Local Persistence

The selected Catbots data directory contains:

```text
Catbots/
├── local.env.yaml
├── local.env.yaml.previous
├── catbots.db
├── backtests/
├── exports/
└── diagnostics/
```

An embedded SQLite database stores local profile metadata, strategies and versions, deployments, node-layout preferences, chat history, runtime state, performance summaries, audit metadata, and indexed trace events. Large Backtest traces and artifacts use compressed immutable files referenced by manifest and integrity hash from SQLite.

The data location is separate from Electron cache/session storage and may be changed only while all bots are stopped. Migration uses copy, verify, atomic pointer update, and rollback rather than moving live files in place.

## 19. Failure and Recovery UX

- Malformed YAML opens Settings in repair mode with a field-level error; secrets remain masked.
- Failed LLM authentication leaves bots and runtime unaffected and offers Test Connection.
- Agent output that fails graph validation is not saved as an approved revision; the Agent receives validation errors.
- Missing/stale data shows `unknown`, identifies the source, and does not execute.
- Runtime process crash changes bot status to `Recovering`, restarts with bounded retries, and reconciles state before resuming.
- Machine resume forces time-gap detection, data refresh, open-order/position reconciliation, and a logged decision to resume or suspend.
- Audit or outbox write failure suspends Live execution before a new DEX side effect.
- Stop remains available even when the LLM provider is offline.

## 20. Accessibility and Keyboard Behavior

- all controls are reachable and operable by keyboard;
- focus is visible in light and dark modes;
- graph nodes have meaningful accessible names and can be traversed without dragging;
- status always uses icon/text in addition to color;
- charts have metric summaries and tabular alternatives;
- dialogs trap focus and restore it to the invoking control;
- reduced-motion preference disables animated graph edges and nonessential transitions;
- minimum target size and contrast follow WCAG 2.1 AA intent.

## 21. Verification Plan

### UI state tests

- First Launch, setup repair, empty Home, Draft, Backtesting, Paper, Live, Paused, Recovering, Error, and Stopped states;
- Settings validation and atomic YAML persistence with secret redaction;
- immutable running version and new-draft behavior;
- Live button disabled for every failed preflight condition.

### Graph tests

- canonical graph maps deterministically to React Flow nodes and edges;
- read-only interaction cannot alter strategy semantics;
- combined conditions, unknown paths, fit view, selection, Inspector, and trace replay;
- keyboard traversal and accessible node labels.

### Desktop integration tests

- secure preload API and rejected malformed/unauthorized IPC messages;
- close-to-tray and Quit-with-running-bots behavior;
- renderer crash while runtime continues;
- runtime crash, bounded restart, and reconciliation;
- sleep/resume suspension and recovery;
- emergency Stop without a healthy renderer.

### Security tests

- no master-wallet-key field exists in schema or Settings, and Live preflight verifies the configured signer is an approved Agent wallet;
- no secret appears in renderer snapshots, logs, exports, diagnostics, or Agent prompts;
- navigation, new-window, permission, and external-link allowlists;
- restrictive Content Security Policy and sandbox configuration;
- audit failure proves fail-closed behavior before Live execution.

## 22. MVP Boundary

Included:

- Electron desktop app in TypeScript with a React/Kumo renderer;
- local profile and Settings-managed `local.env.yaml`;
- OpenAI-compatible and Anthropic-compatible LLM providers;
- Bots Home and AI Bot Workbench;
- read-only `@xyflow/react` TCA visualization;
- Agent-driven graph construction, validation, and Backtest;
- Paper execution and Hyperliquid Live execution;
- dedicated Live Review, risk limits, complete audit traces, Performance, Logs, and Stop;
- background runtime in the system tray;
- local SQLite and immutable Backtest artifacts.

Excluded:

- cloud accounts and sync;
- remote runtime or 24/7 hosted execution;
- drag-and-drop graph editing;
- raw YAML editing in-app;
- arbitrary generated code or user webhooks;
- master-wallet private-key storage;
- third-party data seller and payment workflows;
- additional DEX adapters in the first release.
