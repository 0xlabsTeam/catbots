# Trader node packages

Status: implemented package foundation and local simulation; v3 Paper/Live integration is pending.

## Boundaries and compatibility

The deployed v2 trigger/condition/action graph remains supported. Its twelve builtin definitions now live in separate trigger, condition and action workspace packages. Their execution semantics remain in the existing runtime. Existing saved strategies do not migrate implicitly.

The new v3 graph uses explicit typed input/output ports. Its runtime is separate from v2 approval, backtest, Paper and Live deployment. The Nodes screen identifies all v3 packages as simulation-only. AI discovery exposes this restriction; v3 definitions cannot be submitted as deployable v2 strategies.

## Packages

| Workspace package | Responsibility | Current v3 nodes |
| --- | --- | --- |
| `@catbots/node-kit` | Contracts, package definition and deterministic graph evaluator | No trader nodes |
| `@catbots/nodes-trigger` | Start an evaluation | Evaluation tick |
| `@catbots/nodes-data` | Read snapshot data | Closed candles, price, equity |
| `@catbots/nodes-indicator` | Derive indicators | RSI, EMA, SMA, ATR |
| `@catbots/nodes-process` | Transform values | Number constant, arithmetic |
| `@catbots/nodes-condition` | Test values | Compare, ALL/ANY with two inputs |
| `@catbots/nodes-strategy` | Own deal lifecycle | DCA, Grid, sliced Smart Order |
| `@catbots/nodes-risk` | Derive sizing and exit signals | Position size, trailing exit |
| `@catbots/nodes-action` | Propose execution | Order proposal |
| `@catbots/nodes-output` | Inspect values | Number and condition trace |

Each package owns its definitions/config validation/evaluation and exports a RuntimePackage. `strategy-runtime` assembles them. `node-sdk` re-exports the authoring contracts. These are private workspace source packages; they are not published npm packages. Installation of external executable v3 code is not enabled. The existing community installer still accepts declarative v1 packages.

## Data movement

An evaluation receives one host snapshot: deployment, market, time, price, equity, candles, fills and cancellation acknowledgements. Edges connect an output port to a matching input type. The evaluator validates the entire graph before running it, then evaluates in topological order. Every consumer receives a cloned value; siblings cannot mutate each other's input or the host context.

Values carry `type`, `quality` and `value`. Missing data/indicator warmup produces `unavailable` with a reason. This is not silently converted to zero or a passing condition. Candles use close timestamps; the loader excludes candles that close after evaluation time. Quantity is base units; order price and notional are quote units. Percent settings are percentage points (1 means 1%). Snapshot timestamps are epoch milliseconds. A graph instance is scoped to one market; the host must provide correctly normalized exchange data.

Example: Tick → Closed candles → RSI → Compare below threshold → DCA deal. A separate Number node supplies the threshold. Indicator output can also connect to a trace node.

The graph is acyclic. Stateful strategy nodes carry lifecycle across evaluations instead of graph feedback loops. Each input requires one source; an explicit combiner joins conditions. This avoids ambiguous implicit merge behavior.

## Strategy lifecycle and persistence

Order proposals do not change inventory. Only matching fills do. Controllers retain pending order IDs, filled quantity, lots, seen fill IDs and cycle state. Partial fills remain pending; repeated fill IDs are ignored. DCA averages filled lots, Grid keeps per-level lots, and Smart Order waits for a slice to fill before creating the next. Closing first requests cancellation of conflicting pending orders and waits for acknowledgement. Notional checks include outstanding entries.

The simulation journal commits state, proposals and trace in one local file replacement, guarded by an exclusive lock. A repeated run ID with the same snapshot returns its saved result; different input for that ID is rejected. Graph/package version changes require another deployment. The journal rejects backward time and limits each deployment to 1,000 evaluations. This is a local simulation store, not a production execution outbox. A process crash can leave its lock file behind; automatic stale-lock recovery and retention/compaction remain pending.

## Trader UX

The Nodes screen uses Kumo controls and shows package, category and typed ports. Three deterministic synthetic examples expose proposed-order counts, cancellations, state and outputs. No exchange request is made. The graph editor's eventual palette should use the same nine categories and human names, while keeping package/type identifiers in the inspector. Strategy nodes should expose deal status and inventory rather than drawing every internal safety-order transition on the canvas.

## TradeSanta coverage and remaining work

This is not full TradeSanta parity. Implemented simulation covers the mechanics of averaging, separate Grid lots, sliced orders, partial fills, cancellation acknowledgement, stop loss and independent trailing signals. Our Grid stages multiple limit entries; it does not claim to reproduce every TradeSanta Grid mode.

Before production deployment, implement and test:

1. A v3 persisted bot document, builder validation, approval and version pinning, with explicit migration of existing graphs.
2. A durable execution outbox and exchange reconciliation for disconnects, rejected orders, unknown outcomes, fees, dust, tick/lot size and concurrent fills. Recovery must not duplicate orders.
3. Spot inventory semantics and exchange-specific futures/hedge/margin capabilities. Generic short direction and reduce-only proposals do not provide spot short support.
4. Shared Paper/backtest/live adapters using the same controller events, realistic fills, fees, funding and indicator warmup; protection orders and risk budgets independent of chat availability.
5. Trader configuration for safety-order scaling, trailing take-profit/stop, deal limits/cooldowns, multi-pair allocation and external TradingView/webhook signals with authentication, expiry and deduplication.
6. Template/copy-strategy UX and a test matrix for each advertised bot mode. Copying configuration must never copy credentials or active runtime state.
7. A capability-limited worker runtime, compatibility manifest, integrity verification and resource limits before enabling community executable packages.

Reference material: [TradeSanta documentation](https://tradesanta.com/documentation-new), [strategies](https://tradesanta.com/available-strategies), [Node-RED](https://github.com/node-red/node-red), and the user's [Botfalo](https://github.com/0xlabsTeam/botfalo) design. These informed the boundary choices; no claim of API or behavioral compatibility is made.

## Flow programming editor increment

The Nodes screen now opens a dedicated editable canvas. The palette adds packaged
nodes; the inspector derives configuration fields from their Zod schemas. Explicit
connection validation rejects incompatible port types, multiple sources for one
input and cycles. Cards expose port names; solid Flow wires carry boolean
activation and dashed Data wires carry typed values. Nodes can be repositioned,
configured and removed. Manual inspector connection controls provide an alternative
to dragging ports. Save draft stores graph and layout in this browser's localStorage;
it is not a shared web/desktop project store.

`trigger.tick` also emits a `flow` output. `condition.branch` requires both a flow
activation and a condition, and emits mutually exclusive `true`/`false` flow outputs.
`action.flow_order` only evaluates when its declared activation port is ready and
true. Inactive nodes preserve previous state and emit unavailable data outputs plus
false flow outputs. Unknown activation propagates unavailable, never false. Traces
record executed/skipped/unavailable. Existing snapshot data nodes still evaluate in
topological order; adding this editor does not convert all nodes into event-driven
actors. All activations in one evaluation share the same context/run/market.

Run snapshot evaluates synthetic data locally and creates order proposals only.
The debug timeline stores up to 100 ticks for the current editing session, and
shows exact node inputs/outputs. Editing the graph resets simulation state and run
identity; moving a node does not change evaluation state. No synthetic fills are
injected by this editor. Full order lifecycle simulation remains in the separate
DCA/Grid/Smart Order demonstrations.

Still pending: event queues, scheduled execution, dynamic Join/For-each, editable
Subflows, shared backend draft storage, order submission/fill events, AI authoring,
and integration with v3 Paper/Live. The generic strategy controllers remain
snapshot-driven; they must continue processing fills even when entry signals are
false, so blindly gating them by entry Flow would be incorrect.
