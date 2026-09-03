# AI-first TCA Perp Bot — Architecture Design

**Date:** 2026-09-03

**Status:** Approved in conversation

**Initial venue:** Hyperliquid

**Primary user:** Perp DEX traders who do not write code

## 1. Product Contract

The user selects a market and describes a strategy in natural language. An AI Agent builds and revises a versioned Strategy Graph, validates it, invokes the Backtest Tool, explains the results, and renders a read-only node visualization. A user-approved strategy version can be bound to a Paper or Live Bot Deployment. Live execution becomes autonomous only inside user-approved risk limits.

The canonical representation is JSON, but JSON is an internal contract. MVP users neither read nor edit it directly.

## 2. Core Invariants

1. Every strategy execution path is `Trigger → Condition Graph → Action`.
2. Trigger kinds are limited to `interval` and `event`.
3. Conditions are pure and may be combined into an acyclic boolean graph.
4. Actions are the only strategy nodes allowed to request side effects.
5. An Action cannot directly activate another Action. A later step starts from a new Event Trigger.
6. Strategy JSON stores data references, never live data or credentials.
7. Backtest, Paper, and Live use the same graph validator and evaluator.
8. Every triggered evaluation and every execution attempt produces an append-only audit trace.
9. Live execution fails closed when required data, risk validation, entitlement, or durable pre-execution logging is unavailable.
10. Strategy logic cannot modify Deployment risk limits.

## 3. Canonical Graph

The graph has a deliberately small envelope. New capabilities are introduced through a Node Registry rather than new top-level schema shapes.

```json
{
  "schemaVersion": "1.0",
  "strategy": {
    "id": "btc-etf-rsi",
    "name": "BTC ETF Flow and RSI",
    "version": 1
  },
  "nodes": [],
  "edges": []
}
```

Every node uses the same envelope:

```json
{
  "id": "unique-stable-id",
  "kind": "trigger",
  "type": "interval",
  "version": 1,
  "config": {}
}
```

`kind` is one of `trigger`, `condition`, or `action`. `type` selects a registered implementation within that kind. Stable node IDs make graph diffs and historical decision traces understandable across strategy versions.

### 3.1 Allowed edges

- Trigger → Predicate Condition
- Predicate Condition → Combined Condition
- Combined Condition → Combined Condition
- Predicate or Combined Condition → Action

The validator rejects cycles, mismatched ports, unreachable nodes, an Action without a controlling Condition root, and an execution path that does not originate from exactly one Trigger.

Multiple TCA flows may exist in one strategy. They coordinate through explicit events and state rather than direct Action chaining.

## 4. Trigger Nodes

### 4.1 Interval Trigger

An Interval Trigger activates on a fixed duration aligned to a declared clock boundary. MVP supports durations of one minute or longer and UTC alignment.

```json
{
  "id": "t-15m",
  "kind": "trigger",
  "type": "interval",
  "version": 1,
  "config": {
    "every": "15m",
    "alignment": "utc"
  }
}
```

### 4.2 Event Trigger

An Event Trigger subscribes to a registered event type and may apply equality filters to indexed envelope fields.

```json
{
  "id": "t-etf-update",
  "kind": "trigger",
  "type": "event",
  "version": 1,
  "config": {
    "eventType": "data.etf_flow.updated",
    "filters": { "asset": "BTC" }
  }
}
```

Events use a common envelope:

```json
{
  "id": "evt_123",
  "type": "data.etf_flow.updated",
  "occurredAt": "2026-09-03T08:00:00Z",
  "receivedAt": "2026-09-03T08:00:03Z",
  "source": "provider.etf_flow",
  "payload": {},
  "quality": {
    "status": "verified",
    "freshnessSeconds": 3
  }
}
```

Market, data, execution, position, risk, and bot lifecycle events share this envelope. Event IDs are used for deduplication. Price thresholds and indicator crossovers remain Conditions evaluated after an interval or event activation.

## 5. Condition Graph

Conditions return `true`, `false`, or `unknown`.

- `predicate.*` nodes evaluate one assertion.
- `combine.all` succeeds when all inputs are true.
- `combine.any` succeeds when at least one input is true.
- `combine.not` inverts one known boolean input.
- `combine.at_least` succeeds when a configured number of inputs are true.

Combined Conditions may be nested. Evaluation short-circuits only when the final result is already certain. An `unknown` result never activates an execution Action. The trace records the result and reason for every evaluated Condition.

Example logical shape:

```text
ALL
├── RSI(14) < 30
├── No open position
└── ANY
    ├── BTC ETF net flow > $200M
    └── Funding rate < 0
```

## 6. Data Resolution and Injection

A Condition declares immutable data references. It never calls an API.

```json
{
  "id": "c-etf-positive",
  "kind": "condition",
  "type": "predicate.compare",
  "version": 1,
  "config": {
    "left": {
      "ref": "data.etf_flow.btc.net_daily",
      "field": "usd"
    },
    "operator": "gt",
    "right": { "literal": 200000000 }
  }
}
```

Before evaluating the Condition Graph, the runtime extracts all data dependencies, checks entitlements, and resolves them into one immutable Evaluation Context:

```text
Evaluation Context
├── trigger event
├── market snapshot
├── indicator values
├── marketplace data
├── position and account state
├── bot state
└── evaluation timestamp
```

Each value carries provider, observed-at time, freshness, and quality metadata. Missing, stale, unauthorized, or invalid values become `unknown`; the runtime does not silently substitute a different source.

Backtests resolve the same references against point-in-time historical data. This prevents look-ahead and preserves Backtest/Live parity.

## 7. Action Nodes

Actions request side effects such as opening or closing a position, placing or cancelling an order, updating bot state, sending a notification, or pausing a bot.

```json
{
  "id": "a-open-long",
  "kind": "action",
  "type": "execution.open_position",
  "version": 1,
  "config": {
    "side": "long",
    "size": { "type": "equity_percent", "value": 5 },
    "leverage": 2,
    "stopLoss": { "type": "percent", "value": 2 }
  }
}
```

All execution Actions pass through the system Risk Engine. An Action may emit a registered event after its outcome is known; that event can activate another TCA flow.

## 8. Node Registry

Each registered node definition provides:

- kind, namespaced type, and version;
- config JSON Schema;
- typed input and output ports;
- runtime and backtest evaluators;
- visualization title, icon, summary, and detail renderer;
- data, entitlement, and permission requirements.

The AI Agent may only use registered node types. Arbitrary generated code is not executable in the strategy runtime.

## 9. Strategy and Deployment Separation

A Strategy contains reusable decision logic. A Bot Deployment binds an immutable strategy version to operational resources:

```text
Bot Deployment
├── strategy ID and version
├── Paper or Live mode
├── DEX adapter and account
├── market bindings
├── data entitlements
├── user-approved risk limits
└── lifecycle state
```

Changing the strategy creates a new version. Changing market bindings or increasing a risk limit requires a new deployment approval. Strategy logic cannot read secrets or bypass bindings.

## 10. Perp DEX Adapter

The Execution Engine uses a venue-neutral interface:

```text
PerpDexAdapter
├── getMarkets
├── getBalances
├── getPositions
├── placeOrder
├── cancelOrder
├── updateLeverage
├── closePosition
└── getExecutionEvents
```

Hyperliquid is the only MVP adapter. Venue-specific order requests and responses are normalized at the adapter boundary. Strategy nodes express intent and contain no Hyperliquid-specific fields.

## 11. Data Marketplace Boundary

The initial marketplace is a curated Data Catalog. A data product includes:

- a versioned normalized data contract;
- point-in-time historical data for Backtest;
- live updates published as registered events;
- freshness and quality policy;
- access entitlement and subscription metadata;
- a provider adapter.

For example, an ETF Flow product exposes a normalized reference such as `data.etf_flow.btc.net_daily` and an event such as `data.etf_flow.updated`. Conditions depend on the normalized contract, not a vendor API.

Third-party seller onboarding, payouts, arbitrary user webhooks, and provider self-service are outside MVP scope.

## 12. Agent Tool Loop

The AI Agent receives a catalog of available nodes and data products, then uses explicit tools:

1. `list_nodes` and `list_data_products`
2. `validate_strategy`
3. `backtest_strategy`
4. `explain_strategy` and `compare_versions`
5. `create_deployment`
6. `pause_bot`

The Agent may iterate Strategy creation and Backtest inside the conversation. It cannot approve Live Deployment on the user's behalf or raise risk limits.

## 13. Backtest, Paper, and Live Parity

The same validated Strategy Runtime handles all modes:

```text
Historical Event Stream → Strategy Runtime → Simulated Adapter
Paper Event Stream      → Strategy Runtime → Paper Adapter
Live Event Stream       → Strategy Runtime → Hyperliquid Adapter
```

Backtest simulation includes fees, funding, slippage, latency, partial fills, liquidation rules, and point-in-time data availability. The clock and adapters change by mode; graph semantics do not.

## 14. Mandatory Execution Audit Log

Every Trigger activation creates one `traceId`. The trace is append-only and follows the flow from receipt through completion, including flows that do not place an order.

Required audit event types are:

```text
trigger.received
context.resolution_started
context.resolved | context.failed
condition.evaluated
action.proposed
risk.approved | risk.rejected
execution.queued
execution.submitted
execution.acknowledged | execution.rejected
execution.partially_filled
execution.filled | execution.cancelled
flow.skipped | flow.completed | flow.failed
```

Each audit event includes:

- event ID, trace ID, parent/causation ID, and idempotency key;
- strategy ID/version and deployment ID/mode;
- trigger event ID and evaluation timestamp;
- node ID/type/version;
- referenced input values with provider, observed-at time, freshness, and integrity hash;
- Condition result and machine-readable reason;
- proposed Action and normalized order intent;
- Risk Engine decision and violated rule IDs;
- sanitized adapter request/response metadata;
- retry count, error code, and final status;
- created-at and actor identity.

Credentials, wallet secrets, raw authorization headers, and unrelated account data are never logged.

### 14.1 Durability and ordering

Live Actions use a transactional outbox. The runtime durably records `action.proposed`, the risk decision, and an execution outbox item before any external DEX side effect. If this durable write fails, execution stops. The executor claims the outbox item using its idempotency key and then records every adapter outcome.

If a DEX request succeeds but its response is lost, reconciliation queries the venue using the deterministic client order ID before retrying. This prevents duplicate orders while preserving an auditable final outcome.

Ordering is guaranteed within one trace by a monotonic sequence number. Cross-trace order is derived from recorded event time and ingestion time rather than assumed global ordering.

### 14.2 Storage and access

Supabase Postgres stores immutable audit metadata and indexed trace events. Large Backtest traces are stored as compressed immutable artifacts with a manifest and integrity hash; every triggered evaluation remains recoverable. The UI loads a summarized timeline first and expands node inputs, decisions, and execution details on demand.

Retention is mode-specific but never silently deletes Live audit records. A later retention-policy change requires an explicit product and compliance decision.

## 15. Risk Engine

Before an execution request reaches an adapter, the Risk Engine enforces:

- maximum position and order size;
- maximum leverage;
- maximum daily loss and drawdown;
- allowed markets and sides;
- order-frequency and exposure limits;
- bot and account kill switches.

Risk rejection is a normal, fully logged flow outcome. Live execution is denied when the Risk Engine or audit outbox is unavailable.

## 16. Visualization and Explainability

The read-only visualization uses three primary columns:

```text
TRIGGER          CONDITION GRAPH                 ACTION
Interval 15m → [RSI < 30] ───────┐
               [ETF flow > 0] ───┼→ [ALL] → Open Long
               [No position] ────┘
```

Users can inspect node configuration, current or historical evaluation results, data source and freshness, and the full audit timeline. Editing remains conversational in MVP. The UI highlights `true`, `false`, `unknown`, rejected, failed, and executed paths without changing canonical graph semantics.

## 17. Failure Semantics

- Invalid graphs cannot be version-approved or deployed.
- Missing, stale, unauthorized, or corrupt data yields `unknown` and no execution.
- Duplicate Trigger events reuse the existing idempotency key and do not duplicate Actions.
- Temporary adapter failures follow bounded retry policy and then require reconciliation.
- Risk or durable audit unavailability blocks Live execution.
- A failed Action emits a registered failure event only after its outcome is durably logged.
- One failed TCA flow does not corrupt other flows; shared bot state changes are versioned and atomic.

## 18. Verification Strategy

### Schema and graph tests

- accept valid TCA graphs and nested Condition combinations;
- reject cycles, invalid transitions, unknown node versions, and incompatible ports;
- verify stable serialization and strategy version diffs.

### Evaluator tests

- table-driven tests for every predicate and combiner across true, false, and unknown;
- deterministic Evaluation Context fixtures;
- point-in-time and stale-data tests;
- identical graph results in Backtest, Paper, and Live evaluators.

### Execution and safety tests

- Risk Engine rejection and limit-boundary tests;
- adapter contract tests against Hyperliquid fixtures;
- idempotency, retry, lost-response reconciliation, and partial-fill tests;
- forced audit-store outage proving fail-closed behavior before Live side effects.

### Audit tests

- every terminal flow has a contiguous trace from `trigger.received` to a final event;
- every external order maps to exactly one proposed Action and risk decision;
- sensitive fields are redacted;
- compressed Backtest artifacts reproduce the displayed decision trace.

## 19. MVP Boundary

The MVP includes AI graph authoring, validation, explanation, Backtest, Paper Trading, Hyperliquid Live execution, interval and registered event triggers, combined Conditions, curated indicator and data nodes, one ETF Flow data product, read-only visualization, risk controls, strategy versioning, and complete execution audit traces.

The MVP excludes a drag-and-drop editor, arbitrary code nodes, arbitrary webhooks, third-party seller onboarding, HFT, social/copy trading, and additional DEX adapters.
