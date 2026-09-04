# Catbots M1 Strategy Core and Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deterministic, versioned Trigger–Condition–Action strategy runtime and Backtest engine whose results and complete decision traces can later be consumed unchanged by the AI Workbench, Paper Trading, and Live execution.

**Architecture:** Add a renderer-independent `@catbots/strategy-runtime` package. Its outer boundary parses canonical Strategy JSON, resolves node implementations through an immutable Node Registry, validates graph structure and ports, and compiles each Trigger-rooted flow. Runtime evaluation receives an immutable point-in-time Evaluation Context and returns proposed effects plus append-only audit events; it performs no network, filesystem, or exchange side effects. Backtest replays registered interval/event inputs against the same evaluator with a deterministic clock and a simulated execution adapter, then derives metrics and a content-addressed trace artifact.

**Tech Stack:** TypeScript 5.9, pnpm workspace, Zod 4, Vitest 4, Node.js 22 crypto APIs.

**Spec:** `docs/superpowers/specs/2026-09-03-tca-perp-bot-design.md` sections 2–8 and 13–18; `docs/superpowers/specs/2026-09-03-catbots-desktop-ui-design.md` sections 10, 13, 17–19, and 21; `docs/superpowers/plans/2026-09-03-catbots-delivery-roadmap.md` M1.

## Global Constraints

- Every executable path is exactly `Trigger → one or more Conditions → Action`; Actions cannot activate Actions.
- Trigger implementations are limited to registered interval and event types. Interval durations are UTC-aligned and at least one minute.
- Conditions are pure and return `true`, `false`, or `unknown`. `unknown` never proposes an Action.
- Strategy JSON stores references only. Resolvers inject immutable values with provider, observation time, freshness, quality, and integrity hash.
- The graph, registry, evaluator, and trace semantics are identical across Backtest, Paper, and Live modes; M1 only implements Backtest side effects.
- Node implementations are registered code. Strategy JSON cannot carry or execute arbitrary code.
- Backtests use point-in-time inputs and deterministic ordering. No evaluator may read wall-clock time or make an implicit network call.
- Every trigger activation produces a contiguous append-only trace ending in `flow.skipped`, `flow.completed`, or `flow.failed`, even when no order is proposed.
- Trace payloads are serializable, deterministic, sanitized, and contain no credentials or authorization headers.
- M1 does not add Paper/Live deployment, Risk Engine approval, Hyperliquid calls, SQLite persistence, AI tools, React Flow, or renderer UI.
- Use test-driven development. Commit each independently reviewable task without including unrelated working-tree changes.

---

## Planned File Structure

```text
packages/strategy-runtime/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── strategy-schema.ts
    ├── strategy-schema.test.ts
    ├── node-registry.ts
    ├── node-registry.test.ts
    ├── builtins.ts
    ├── graph-validator.ts
    ├── graph-validator.test.ts
    ├── evaluation-context.ts
    ├── condition-evaluator.ts
    ├── condition-evaluator.test.ts
    ├── triggers.ts
    ├── triggers.test.ts
    ├── audit-trace.ts
    ├── runtime.ts
    ├── runtime.test.ts
    ├── backtest-types.ts
    ├── simulation-clock.ts
    ├── simulation-clock.test.ts
    ├── simulated-adapter.ts
    ├── simulated-adapter.test.ts
    ├── metrics.ts
    ├── metrics.test.ts
    ├── backtest.ts
    ├── backtest.test.ts
    └── fixtures/
        ├── btc-etf-rsi.ts
        └── btc-etf-rsi-inputs.ts
```

Responsibility boundaries:

- `strategy-schema.ts` owns only the canonical serializable envelope and stable serialization.
- `node-registry.ts` owns registered node metadata and runtime functions; `builtins.ts` assembles the M1 registry.
- `graph-validator.ts` validates topology, reachability, versions, typed ports, and Trigger ownership without evaluating values.
- `evaluation-context.ts` owns immutable point-in-time values and explicit `unknown` reasons.
- `condition-evaluator.ts` owns predicate and combiner truth tables.
- `triggers.ts` owns interval schedules and event matching.
- `runtime.ts` compiles valid Trigger-rooted flows and evaluates them into proposed effects plus traces.
- `simulation-clock.ts` and `simulated-adapter.ts` replace wall-clock time and exchange effects in Backtest.
- `metrics.ts` derives results from the normalized simulation ledger; `backtest.ts` orchestrates replay and artifact hashing.

---

### Task 1: Create the canonical Strategy JSON contract

**Files:**

- Create: `packages/strategy-runtime/package.json`
- Create: `packages/strategy-runtime/tsconfig.json`
- Create: `packages/strategy-runtime/src/strategy-schema.ts`
- Create: `packages/strategy-runtime/src/strategy-schema.test.ts`
- Create: `packages/strategy-runtime/src/index.ts`
- Modify: `vitest.workspace.ts`

**Interfaces:**

- Produces `StrategyDocumentSchema`, `StrategyDocument`, `StrategyNode`, and `StrategyEdge`.
- Produces `parseStrategyDocument(input)` and `serializeStrategyDocument(document)` with stable object-key ordering and preserved array order.

- [x] **Step 1: Add package manifests and a failing canonical-document test**

Test a valid `schemaVersion: "1.0"` document, strict rejection of unknown envelope keys, duplicate node IDs, missing node references, and stable serialization of the same semantic document.

- [x] **Step 2: Run the focused test and confirm missing-module failure**

Run: `pnpm --filter @catbots/strategy-runtime test -- strategy-schema.test.ts`

Expected: FAIL because the schema module does not exist.

- [x] **Step 3: Implement the smallest strict envelope parser**

Use discriminated `kind` values `trigger | condition | action`, non-empty stable IDs, namespaced type strings, positive integer node versions, and edges with `source`, `sourcePort`, `target`, and `targetPort`. Keep node `config` as JSON at the envelope layer; registry definitions validate it later.

- [x] **Step 4: Verify focused tests and package typecheck**

Run: `pnpm --filter @catbots/strategy-runtime test -- strategy-schema.test.ts`

Expected: PASS.

Run: `pnpm --filter @catbots/strategy-runtime typecheck`

Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/strategy-runtime vitest.workspace.ts pnpm-lock.yaml
git commit -m "feat: define canonical strategy document"
```

---

### Task 2: Implement the immutable Node Registry and M1 built-ins

**Files:**

- Create: `packages/strategy-runtime/src/node-registry.ts`
- Create: `packages/strategy-runtime/src/node-registry.test.ts`
- Create: `packages/strategy-runtime/src/builtins.ts`
- Modify: `packages/strategy-runtime/src/index.ts`

**Interfaces:**

```ts
type NodeDefinition = {
  kind: 'trigger' | 'condition' | 'action';
  type: string;
  version: number;
  configSchema: z.ZodType;
  inputs: readonly PortDefinition[];
  outputs: readonly PortDefinition[];
  visualization: { title: string; icon: string; summary: (config: unknown) => string };
  requirements: { data: readonly string[]; entitlements: readonly string[]; permissions: readonly string[] };
};
```

- [x] **Step 1: Write failing registry tests**

Cover exact lookup by `(kind,type,version)`, duplicate-registration rejection, immutable lookup results, invalid config errors with node IDs, and refusal of unknown versions.

- [x] **Step 2: Run the test and confirm missing exports**

Run: `pnpm --filter @catbots/strategy-runtime test -- node-registry.test.ts`

Expected: FAIL because `NodeRegistry` is unavailable.

- [x] **Step 3: Implement registry construction and built-in definitions**

Register:

- `trigger.interval@1`, `trigger.event@1`;
- `predicate.compare@1`, `predicate.position_state@1`;
- `combine.all@1`, `combine.any@1`, `combine.not@1`, `combine.at_least@1`;
- `execution.open_position@1`, `execution.close_position@1`, `state.set@1`.

Expose each definition's strict config schema, typed boolean/control ports, visualization metadata, and declared requirements. Registry construction returns a frozen registry and never exposes its mutable map.

- [x] **Step 4: Verify tests and typecheck**

Run: `pnpm --filter @catbots/strategy-runtime test -- node-registry.test.ts`

Expected: PASS.

Run: `pnpm --filter @catbots/strategy-runtime typecheck`

Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/strategy-runtime/src
git commit -m "feat: add strategy node registry"
```

---

### Task 3: Validate TCA graph structure and typed ports

**Files:**

- Create: `packages/strategy-runtime/src/graph-validator.ts`
- Create: `packages/strategy-runtime/src/graph-validator.test.ts`
- Modify: `packages/strategy-runtime/src/index.ts`

**Interfaces:**

- Produces `validateStrategy(document, registry): ValidationResult`.
- Produces stable errors `{ code, message, nodeId?, edgeId? }` sorted by document position and code.
- Produces a compiled adjacency model only when the document is valid.

- [x] **Step 1: Write a table-driven failing validator suite**

Accept multiple independent TCA flows and nested combiners. Reject cycles, duplicate edges, mismatched ports, unknown node/version/config, unreachable nodes, Trigger-to-Action, Condition-to-Trigger, Action outgoing edges, Action without a controlling Condition root, and paths whose nodes are reachable from zero or more than one Trigger.

- [x] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/strategy-runtime test -- graph-validator.test.ts`

Expected: FAIL because `validateStrategy` is unavailable.

- [x] **Step 3: Implement deterministic validation passes**

Perform registry/config checks, edge/port checks, topological cycle detection, forward reachability, reverse Action ancestry, and exactly-one-Trigger ownership. Return all safely discoverable errors instead of throwing on the first invalid edge.

- [x] **Step 4: Verify focused and package tests**

Run: `pnpm --filter @catbots/strategy-runtime test -- graph-validator.test.ts`

Expected: PASS.

Run: `pnpm --filter @catbots/strategy-runtime test`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/strategy-runtime/src
git commit -m "feat: validate TCA strategy graphs"
```

---

### Task 4: Resolve immutable Evaluation Context and three-valued Conditions

**Files:**

- Create: `packages/strategy-runtime/src/evaluation-context.ts`
- Create: `packages/strategy-runtime/src/condition-evaluator.ts`
- Create: `packages/strategy-runtime/src/condition-evaluator.test.ts`
- Modify: `packages/strategy-runtime/src/builtins.ts`
- Modify: `packages/strategy-runtime/src/index.ts`

**Interfaces:**

- Produces `EvaluationValue<T>` with `value`, `provider`, `observedAt`, `freshnessSeconds`, `quality`, and `integrityHash`.
- Produces `EvaluationContext` with evaluation timestamp, trigger event, market, indicators, marketplace data, positions/account, and bot state.
- Produces `ConditionResult = { value: true | false | 'unknown'; reason: ConditionReason; inputs: ReferencedInput[] }`.

- [x] **Step 1: Write failing truth-table and reference tests**

Cover every comparator and every combiner over true/false/unknown, nested combinations, `combine.not` cardinality, `combine.at_least` certainty bounds, missing references, stale values, unauthorized values, invalid values, and immutable context snapshots.

- [x] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/strategy-runtime test -- condition-evaluator.test.ts`

Expected: FAIL because context and evaluator modules are unavailable.

- [x] **Step 3: Implement explicit reference resolution and truth tables**

Never substitute data sources. Resolve a configured reference to either one provenance-bearing value or an `unknown` reason code. Short-circuit combiners only when the final result is certain, while preserving a result record for every visited Condition.

- [x] **Step 4: Verify**

Run: `pnpm --filter @catbots/strategy-runtime test -- condition-evaluator.test.ts`

Expected: PASS.

Run: `pnpm --filter @catbots/strategy-runtime typecheck`

Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/strategy-runtime/src
git commit -m "feat: evaluate three-valued conditions"
```

---

### Task 5: Implement interval/event activation and complete runtime traces

**Files:**

- Create: `packages/strategy-runtime/src/triggers.ts`
- Create: `packages/strategy-runtime/src/triggers.test.ts`
- Create: `packages/strategy-runtime/src/audit-trace.ts`
- Create: `packages/strategy-runtime/src/runtime.ts`
- Create: `packages/strategy-runtime/src/runtime.test.ts`
- Modify: `packages/strategy-runtime/src/index.ts`

**Interfaces:**

- Produces `matchesEventTrigger(config, event)` and `intervalActivations(config, from, to)`.
- Produces `evaluateTrigger(compiledStrategy, triggerInput, context): RuntimeEvaluation`.
- Runtime output includes proposed normalized effects and monotonically sequenced audit events.

- [x] **Step 1: Write failing trigger tests**

Cover UTC alignment, one-minute lower bound, inclusive/exclusive range boundaries, event type/filter matching, event deduplication key derivation, and stable ordering when timestamps match.

- [x] **Step 2: Implement trigger activation functions and verify**

Run: `pnpm --filter @catbots/strategy-runtime test -- triggers.test.ts`

Expected: PASS after implementation.

- [x] **Step 3: Write failing runtime/audit tests**

Assert contiguous sequence numbers and the required Backtest subset:

`trigger.received → context.resolution_started → context.resolved|context.failed → condition.evaluated* → action.proposed* → execution.queued* → execution.submitted* → execution.acknowledged|execution.rejected* → execution.partially_filled* → execution.filled|execution.cancelled* → flow.skipped|flow.completed|flow.failed`.

Also cover `unknown` suppression, false branches, two Actions controlled by one root, sanitized inputs, deterministic trace/idempotency IDs, and exactly one terminal event.

- [x] **Step 4: Implement runtime evaluation and trace builder**

Runtime accepts IDs and time from injected deterministic services. It does not call `Date.now`, `Math.random`, storage, network, or an execution venue. Backtest uses a simulation approval in place of the M3 Risk Engine and labels it as simulation metadata rather than a live risk approval.

- [x] **Step 5: Verify and commit**

Run: `pnpm --filter @catbots/strategy-runtime test -- triggers.test.ts runtime.test.ts`

Expected: PASS.

```bash
git add packages/strategy-runtime/src
git commit -m "feat: run triggered strategy flows with audit traces"
```

---

### Task 6: Add deterministic clock and simulated execution ledger

**Files:**

- Create: `packages/strategy-runtime/src/backtest-types.ts`
- Create: `packages/strategy-runtime/src/simulation-clock.ts`
- Create: `packages/strategy-runtime/src/simulation-clock.test.ts`
- Create: `packages/strategy-runtime/src/simulated-adapter.ts`
- Create: `packages/strategy-runtime/src/simulated-adapter.test.ts`
- Modify: `packages/strategy-runtime/src/index.ts`

**Interfaces:**

- Produces `SimulationClock` that advances only through ordered historical inputs.
- Produces `SimulatedExecutionAdapter` with normalized orders, fills, positions, cash, fees, funding, slippage, latency, partial fills, and liquidation ledger entries.

- [x] **Step 1: Write failing clock tests**

Assert monotonic advancement, rejection of time travel, deterministic order for equal timestamps, and repeatable interval emissions.

- [x] **Step 2: Implement and verify the clock**

Run: `pnpm --filter @catbots/strategy-runtime test -- simulation-clock.test.ts`

Expected: PASS.

- [x] **Step 3: Write failing adapter tests**

Cover open/close market intents, deterministic latency/slippage, fee and funding debits, configurable partial fills, partial close behavior, leverage/margin accounting, liquidation, rejection on absent point-in-time prices, and deterministic client order IDs. Explicit limit-order simulation arrives with a registered limit-order Action rather than adding an unregistered execution shape.

- [x] **Step 4: Implement the normalized simulation ledger**

All fill-model assumptions arrive in `BacktestAssumptions`; no hidden defaults may change between runs. Use integer timestamps and decimal-safe quote/base quantities represented as decimal strings at public boundaries.

- [x] **Step 5: Verify and commit**

Run: `pnpm --filter @catbots/strategy-runtime test -- simulation-clock.test.ts simulated-adapter.test.ts`

Expected: PASS.

```bash
git add packages/strategy-runtime/src
git commit -m "feat: simulate deterministic order execution"
```

---

### Task 7: Derive Backtest metrics and immutable artifacts

**Files:**

- Create: `packages/strategy-runtime/src/metrics.ts`
- Create: `packages/strategy-runtime/src/metrics.test.ts`
- Create: `packages/strategy-runtime/src/backtest.ts`
- Create: `packages/strategy-runtime/src/backtest.test.ts`
- Modify: `packages/strategy-runtime/src/index.ts`

**Interfaces:**

- Produces return, maximum drawdown, Sharpe-like metric, win rate, trade count, fees, funding, equity curve, and warnings.
- Produces `runBacktest(request): BacktestResult` with manifest, strategy/input/assumption hashes, metrics, trades, and complete traces.

- [x] **Step 1: Write failing metric tests with hand-calculated ledgers**

Cover empty runs, flat equity, gains/losses, drawdown recovery, zero variance, closed versus open trades, fees, funding, and non-finite-number rejection.

- [x] **Step 2: Implement pure metric reducers and verify**

Run: `pnpm --filter @catbots/strategy-runtime test -- metrics.test.ts`

Expected: PASS.

- [x] **Step 3: Write failing Backtest orchestration tests**

Assert point-in-time context resolution, stable event ordering, cancellation, progress phases, reproducible result hashes, changed hashes when strategy/input/assumptions change, and warnings for sparse or stale data.

- [x] **Step 4: Implement orchestration and artifact manifest**

Hash canonical UTF-8 JSON with SHA-256. The package returns artifact bytes and metadata but does not write files; Electron utility-process persistence is integrated in M2.

- [x] **Step 5: Verify and commit**

Run: `pnpm --filter @catbots/strategy-runtime test -- metrics.test.ts backtest.test.ts`

Expected: PASS.

```bash
git add packages/strategy-runtime/src
git commit -m "feat: produce deterministic backtest artifacts"
```

---

### Task 8: Prove the complete M1 acceptance fixture

**Files:**

- Create: `packages/strategy-runtime/src/fixtures/btc-etf-rsi.ts`
- Create: `packages/strategy-runtime/src/fixtures/btc-etf-rsi-inputs.ts`
- Modify: `packages/strategy-runtime/src/backtest.test.ts`
- Modify: `README.md`

**Interfaces:**

- Fixture includes one interval flow, one ETF Flow event flow, nested `ALL`/`ANY`, RSI and ETF references, position state, open/close Actions, stale-data `unknown`, and point-in-time market/funding inputs.

- [ ] **Step 1: Add the acceptance test before the fixture**

Run the same fixture twice in fresh runtime instances and assert byte-identical canonical result JSON, identical artifact hash, identical trades/metrics, and traces for executed, skipped, and unknown paths.

- [ ] **Step 2: Confirm the missing-fixture failure**

Run: `pnpm --filter @catbots/strategy-runtime test -- backtest.test.ts`

Expected: FAIL because the acceptance fixture is unavailable.

- [ ] **Step 3: Implement the fixture and document M1 usage**

README examples parse, validate, and backtest the fixture through public package exports only. Explicitly state that M1 is simulation-only and makes no performance promise.

- [ ] **Step 4: Run milestone verification**

Run: `pnpm --filter @catbots/strategy-runtime test`

Expected: all strategy-runtime tests pass.

Run: `pnpm typecheck`

Expected: exit 0.

Run: `pnpm test`

Expected: all workspace tests pass, including existing M0 desktop/contracts suites.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add packages/strategy-runtime README.md pnpm-lock.yaml
git commit -m "test: prove deterministic M1 backtest flow"
```

---

## Completion Gate

- [ ] Every M1 built-in node has a strict config schema, typed ports, visualization metadata, and requirements metadata.
- [ ] Valid nested and multi-flow TCA graphs compile; every forbidden topology has a stable validation error.
- [ ] All Condition truth tables explicitly cover `unknown` and no unknown path proposes an Action.
- [ ] Backtest evaluation is point-in-time and deterministic across fresh processes.
- [ ] Fees, funding, slippage, latency, partial fills, and liquidation are explicit tested assumptions.
- [ ] Every trigger has a complete terminal trace and reproducible integrity hash.
- [ ] Public trace/artifact schemas contain no secret-bearing fields.
- [ ] Existing M0 desktop behavior remains green and Paper/Live execution remains unavailable.
- [ ] The plan and implementation contain no `TBD`, `TODO`, placeholder, or arbitrary-code escape hatch.
