# Task 8 implementation report

## Outcome

Implemented durable parent/child market traces and dynamic Strategy 2.0 Paper/Live deployments on base `c2c8d642fe0d2be6104dad7fba4d4f5803c9dfe5`.

- Added append-only migration **6** for nullable audit hierarchy and market-context columns plus the two required indexes. Migrations 1–5 were not edited.
- New Paper and Live starts accept only Strategy 2.0 `dex_universe` documents, refresh and validate the DEX universe before starting, and persist record-version-2 dynamic deployments.
- Legacy deployment rows remain readable, pausable/stoppable, and are never used for new starts.
- Paper triggers refresh the universe, fan out through `coordinateEvaluation`, evaluate each child with the same market bound through context/risk/execution, and stage the entire parent run so an audit failure or duplicate parent rolls back all staged portfolio changes.
- Parent and child traces durably preserve deployment, DEX, market, universe revision, context observed time, and sanitized data-reference metadata. Raw values and malformed provider/hash metadata are not persisted.
- Live proposal/outbox, retries, adapter outcomes, terminal events, fills, and reconciliation propagate the stored trace identity. Adapter exceptions and receipt strings are reduced to bounded safe codes/identifiers.
- Dynamic execution idempotency includes deployment, strategy/version, parent trace, child trace, market, and action node. Coordinator trace identity is also deployment-scoped, preventing identical triggers in two deployments from colliding.

## TDD evidence

RED observations were recorded before implementation for:

- missing migration 6 columns/indexes and missing `recordCoordinatedTrace`;
- legacy-bound Paper/Live starts and missing Strategy 2.0 rejection;
- absent multi-market parent/child persistence and transaction rollback;
- absent outbox/reconciliation identity propagation;
- idempotency keys unchanged when parent identity changed;
- missing signer-free Hyperliquid public metadata client;
- raw adapter error text entering audit metadata;
- parent trace IDs unchanged across two deployment IDs.

Each case was subsequently made GREEN with a focused regression test.

## Verification (Node 22.23.2)

- Required five-suite command: **PASS**, 5 files / 29 tests.
- Additional database, IPC security, and Hyperliquid client suites: **PASS**, 3 files / 61 tests.
- Execution-core suites (including dynamic idempotency): **PASS**, 2 files / 21 tests.
- Strategy-runtime suites (including deployment-scoped coordinator identity): **PASS**, 11 files / 125 tests.
- Desktop typecheck: **PASS**.
- Workspace typecheck: **PASS**.
- `git diff --check`: **PASS**.

The optional full workspace test run reached 317 passing desktop tests and one unrelated failure in `apps/desktop/tests/agent-tools.test.ts`: its legacy malformed-document assertion expects separate `schemaVersion` and `strategy.name` paths, while the already-landed Strategy 1.0/2.0 union reports the union failure at `strategy`. Task 8 does not modify the Agent tool or Strategy document error mapping; the required Task 8 suites and all typechecks pass.

## Rulings and boundary notes

- Followed the progress-ledger authority that Task 2 already consumed migration 5. Task 8 uses migration 6 and changes no applied migration.
- Narrow supporting edits were required outside the plan's nominal file list: the public audit DTO represents the new identity/reference fields; execution-core creates the required dynamic key; the coordinator includes deployment identity; PaperAdapter exposes coordinated staging; IPC awaits the now-asynchronous preflight; and Main injects a signer-free universe cache. These are integration seams for Task 8 rather than later UI/Agent behavior.
- Live uses an explicitly invoked coordinated ingestion entrypoint and retains the existing durable outbox executor for adapter submission. No autonomous scheduler is introduced.

## Fix round 1

Addressed all three Important review findings:

1. Added explicit `ingestLive`: it refreshes the dynamic universe, calls `coordinateEvaluation`, evaluates Task 7 risk with the same child market/context/revision, persists the real parent and children, and appends each approved Action proposal, risk approval, and outbox intent to its already-persisted child inside one outer transaction. Duplicate parents short-circuit before new outboxes, and a forced child outbox failure rolls back the complete new parent run.
2. Added strict bounded audit DTOs for condition `{result, reason}` and known execution effects. Persistence round trips true, false, and unknown results plus reconstructable open/close configuration while omitting raw condition inputs/provider values and unknown Action types/configurations.
3. Main now initializes the universe cache, starts its periodic refresh under an owned abort signal, and aborts/stops it before runtime/database shutdown. Lifecycle and real cache timer tests cover startup, refresh ownership, cancellation, and idempotent stop behavior.

Fix-round RED evidence: missing `ingestLive`; missing condition/effect DTOs; a durably queued Live evaluation ending `flow.failed`; and zero cache lifecycle calls from Main. Fix-round GREEN evidence: 7 focused desktop suites / 50 tests, 11 strategy-runtime suites / 126 tests, 2 execution-core suites / 21 tests, and desktop/workspace typechecks all pass under Node 22.23.2.

## Fix round 2

Addressed all three Important re-review findings:

1. Shared child traces now derive completion from every outbox on that trace. A terminal adapter outcome leaves the child open while any sibling action is pending, claimed, or unknown; the final acknowledged/rejected or reconciled outcome appends exactly one terminal flow event. Re-running an already terminal item performs no venue call and safely repairs a missing terminal trace after a crash.
2. Main treats an initial universe refresh failure as unavailable metadata instead of a fatal startup error. It logs only a fixed sanitized status, continues IPC/runtime/UI startup, and starts periodic refresh for recovery under the same owned abort signal. Shutdown still aborts the owner and cancels the refresher before closing runtime/database resources. Live ingestion continues to refresh and fail closed when current metadata is unavailable, while stop/close lifecycle operations do not depend on a snapshot.
3. Coordinated Live persistence now retains every bounded `action.proposed` and `risk.approved`/`risk.rejected` decision for mixed children, while creating outbox rows only for approved actions. The complete parent, children, decisions, and approved outboxes remain one immediate transaction, so a staging failure rolls the hierarchy back.

Round-two RED evidence was observed for premature child completion after the first of two approved actions, loss of the rejected action/decision in a mixed evaluation, and Main abandoning startup when the initial universe fetch rejected.

Round-two GREEN verification under Node 22.23.2:

- Focused Live ingestion/execution/reconciliation/lifecycle: **PASS**, 4 files / 25 tests.
- Task 8 repository, Paper, Live, outbox, reconciliation, cache, and Main lifecycle suites: **PASS**, 7 files / 52 tests.
- Contracts: **PASS**, 4 files / 31 tests.
- Strategy runtime: **PASS**, 11 files / 126 tests.
- Execution core: **PASS**, 2 files / 21 tests.
- Desktop typecheck: **PASS**.
- Workspace typecheck: **PASS**.
- `git diff --check`: **PASS**.

The broad desktop run reached 319 passing tests and one skipped test. Its sole failure remains the previously documented, unrelated `apps/desktop/tests/agent-tools.test.ts` malformed Strategy union diagnostic expectation; no Task 8 file participates in that failure.

## Fix round 3

Addressed both P2 re-review findings:

1. Live child terminal derivation now considers durable risk decisions as well as every staged outbox. Once all approved outboxes are terminal, any persisted `risk.rejected` forces `flow.failed`, matching the runtime result for a mixed approved/rejected evaluation. A coordinated two-market regression executes each approved order to acknowledgement and verifies both mixed children close failed with their rejection evidence intact.
2. Reconciliation now begins with an idempotent repair pass over acknowledged/rejected outboxes. If a process failure occurs after the reconciled outcome transaction commits but before the trace-closure transaction, the next pass derives the terminal state from durable outbox/audit data and closes the still-open trace without querying the venue again. Trace append plus status update remains one transaction, and closed traces are excluded on later passes. Fault injection verifies one submission, one reconciled fill event, and one terminal event across the retry.

Round-three RED evidence was observed for a mixed child incorrectly closing completed after its approved order acknowledged, and for a reconciled acknowledged outbox whose open trace was ignored on the next reconciliation pass after simulated closure failure.

Round-three GREEN verification under Node 22.23.2:

- Focused repository, Live, outbox, and reconciliation: **PASS**, 4 files / 22 tests.
- Task 8 repository, Paper, Live, outbox, reconciliation, cache, and Main lifecycle suites: **PASS**, 7 files / 53 tests.
- Contracts: **PASS**, 4 files / 31 tests.
- Strategy runtime: **PASS**, 11 files / 126 tests.
- Execution core: **PASS**, 2 files / 21 tests.
- Desktop typecheck: **PASS**.
- Workspace typecheck: **PASS**.
- `git diff --check`: **PASS**.
