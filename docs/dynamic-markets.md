# Dynamic markets

Catbots treats a Bot as a strategy workspace for one DEX. The Bot does not own a fixed pair. Its approved Strategy decides which markets qualify on each evaluation, and the execution layer independently proves that every proposed order belongs to the Bot's DEX and current evaluation.

This separation lets a single Bot express an ETH-only rule, a finite set of named pairs, or a DEX-wide screener without allowing an Action to escape the Condition context.

## User workflow

1. On **Bots**, select **Create new bot**.
2. Enter **Bot name** and choose **DEX: Hyperliquid**. Hyperliquid is currently the only DEX identifier; no market is selected here.
3. Describe the Strategy in Chat. Include the Trigger, entry and exit Conditions, sizing, and market intent.
4. Inspect the read-only `Trigger → Condition → Action` graph. A valid new revision uses Strategy schema `2.0` and scope `dex_universe`.
5. Run a Backtest. Check aggregate metrics, declared **Dataset coverage**, **By market** metrics, warnings, and child traces.
6. Select **Approve v…**, then **Confirm approval** for the exact revision you reviewed. Editing later creates another draft and does not change the approved revision.
7. Select **Run Paper** or **Review Live**, review the scope and shared risk limits, then start the deployment.
8. The new deployment waits for external/runtime Trigger ingestion. After an ingestion source invokes the coordinator, use **Performance** for Paper positions/orders and **Logs** for ordered audit events. Pause or Stop Paper; use **Stop Live** for a running testnet deployment.

The Workbench displays `Hyperliquid · Dynamic markets`. Deployment review displays `DEX: Hyperliquid` and `Market access: All active perpetual markets`.

## Fixed symbols and screeners

Market selection is Strategy logic, not Bot configuration.

A fixed-symbol Strategy adds a normal Condition:

```text
Every hour
→ market.symbol = ETH-PERP AND RSI(14) < 20 AND current-market position is flat
→ open a Long on currentMarket
```

A screener omits the symbol equality and uses current-market values:

```text
Every 15 minutes
→ market.volume is in the top 10 AND market.funding < 0 AND RSI(14) < 30
→ open a Long on currentMarket
```

Ask Chat to clarify the market intent if a request could mean either. A screener can propose positions in multiple markets, but every proposal still passes per-order, per-market, and shared portfolio risk checks.

Trading language has a conservative default: “buy ETH” opens or increases an ETH Long, while “sell ETH” closes or reduces an existing ETH Long. Opening or increasing a Short requires an explicit request such as “open an ETH Short.” An ordinary sell instruction never implies a new Short.

## `currentMarket` binding

Strategy 2.0 declares:

```json
{
  "schemaVersion": "2.0",
  "marketScope": { "type": "dex_universe" }
}
```

For an interval Trigger, the coordinator resolves a point-in-time DEX universe and creates one child evaluation for each eligible active market. Each child receives an immutable `currentMarket`. Market and indicator references—including `market.symbol`, price, funding, volume, rank, and RSI—resolve within that child.

Actions do not accept a symbol override. The runtime stamps `currentMarket` onto every proposed effect, and the Risk Engine checks that the effect, normalized order intent, child trace, market metadata, deployment, Bot, and DEX all agree. A Strategy cannot evaluate ETH and submit an order for BTC.

A market-scoped Event evaluates only the market carried by the Event. A registered DEX-scoped Event may fan out across the active universe. External data-marketplace Events without a market remain DEX-wide inputs; they do not invent a market identity or authorize an order by themselves.

## Backtest coverage and metrics

Backtests use the markets and metadata present in the historical dataset at each replay timestamp. They do not consult today's live Hyperliquid listings. This point-in-time membership prevents a newly listed market from appearing before it existed in the dataset.

The Backtest market-universe choice is either:

- `all_available`: every market covered by the point-in-time dataset; or
- `include`: a named subset that must exist in the dataset coverage.

The selection is an evaluation optimization; it does not rewrite the Strategy. A fixed-symbol Condition is still what restricts Strategy behavior to that symbol.

One Backtest shares cash, equity, positions, exposure, and order-rate budget across all evaluated markets. The result presents aggregate return, drawdown, equity, realized PnL, fees, funding, trades, and win rate, followed by per-market realized PnL, trade count, win rate, drawdown contribution, and trace links.

Every simulated fill first passes the shared Risk Engine, including the historical market's maximum leverage. Callers can supply `assumptions.riskLimits` with the same strict limits used by Paper/Live. For older requests without this field, compatibility defaults are 50× starting capital for order, position, and total exposure, 50× leverage, starting capital for daily loss, 100% drawdown, both sides, and 600 orders/minute. These are simulation compatibility ceilings, not recommended trading limits or observed venue metadata. The historical venue ceiling still applies. Funding is applied once per market and replay timestamp, even when several Trigger flows run at that time; conflicting rates for the same occurrence fail explicitly.

Drawdown risk tracks every marked/accounting equity peak, including frames with no Action. The reported equity curve also retains these peaks, so a skipped flow cannot hide a peak from a later risk check.

Always read the displayed market list and date range. Bundled sample data covers only its labeled fixture universe and is not a claim about all Hyperliquid markets. Missing required coverage, stale data, or unavailable marks produce explicit warnings or a failed/unknown path; Catbots does not substitute another market.

## Paper and Hyperliquid testnet

Paper and Live share Strategy 2.0 market binding and risk rules, but their side effects differ.

| Mode | What happens | Credentials | Venue consequence |
| --- | --- | --- | --- |
| Paper | Catbots simulates positions and filled orders locally using the selected DEX's normalized universe. | No exchange credential is used. | No order leaves the computer. |
| Hyperliquid testnet Live | Catbots performs preflight, durably queues approved actions, sends real API requests through the Hyperliquid adapter, and reconciles uncertain outcomes. | Dedicated Agent/API Wallet plus the master account's public address. | Orders affect the configured Hyperliquid testnet account only. |

Mainnet is not selectable. Treat testnet credentials as sensitive and never enter a master-wallet private key.

Before Paper starts, review the DEX-wide scope and shared portfolio limits: maximum order, per-market position, total exposure, leverage, daily loss, drawdown, allowed sides, and order rate. Live adds account, connection, data freshness, audit, runtime, and reconciliation checks plus an exact bot-name confirmation.

An approved revision is immutable. New Paper and Live deployments require an approved Strategy 2.0 revision; a legacy Strategy cannot be used to create a new dynamic deployment.

### Deployment start and Trigger ingestion

Starting is initialization, not a market event. **Start Paper** validates the approved Strategy and current DEX universe, persists the deployment, creates its local Paper adapter, and leaves it waiting. **Start Live** validates the exact preflight and confirmation, persists the testnet deployment, and also leaves it waiting.

The normal app in this release has no autonomous market-trigger ingestion or interval scheduler. Start alone therefore produces no Strategy evaluations, proposed Actions, orders, or execution-event flow; Paper Logs display **Waiting for the first trigger**. A running status means the deployment is eligible to receive input, not that the configured interval is being scheduled in the background.

An external/runtime integration is the ingestion source. It must observe a Trigger occurrence, resolve typed and timestamped Evaluation Context values, and invoke the deployment coordinator (`DeploymentService.ingest` for Paper or `DeploymentService.ingestLive` for testnet Live). That production entry refreshes the DEX universe, fans out child evaluations with immutable `currentMarket`, applies risk, and records the audit trail. Approved Live Actions become durable outbox items before the Hyperliquid adapter submits them. Venue and data adapters supply normalized inputs or perform approved side effects; they do not schedule the Strategy or choose an Action's market.

## Listings, inactive markets, and freshness

The Hyperliquid adapter is the authority for perpetual-market metadata. Catbots refreshes the normalized universe at startup, before deployment, and periodically while running. Metadata includes the symbol, active state, size precision, and maximum leverage.

- A newly active listing becomes eligible after a successful universe refresh. Strategy Conditions and normal risk checks still decide whether it can trade.
- An inactive or removed market is excluded from new-entry fan-out.
- A position-increasing order requires fresh metadata proving that the market is active and belongs to the selected DEX.
- An existing inactive-market position remains visible. Catbots permits an action only when the known position and intent prove that it reduces absolute exposure or closes the position.
- A Trigger owning a close flow can evaluate held inactive markets. Any increase proposed by that same flow still fails risk. After a refresh failure, Paper and Live can use the last trusted universe for a provable reduction; that fallback never authorizes an increase.
- Stale, missing, ambiguous, wrong-DEX, or wrong-revision metadata fails closed for increases. It never broadens access.

Stop and provably reducing close operations remain available when the venue can establish their safety.

## Execution logs and audit evidence

One interval occurrence creates a parent trace with the DEX and universe revision, then one child trace per evaluated market. A child records the market, metadata revision, point-in-time data references and freshness, three-valued Condition results, bound Action proposal, risk decision, execution transitions, and terminal outcome.

A successful Paper child normally includes this ordered evidence:

```text
trigger.received
condition.evaluated
action.proposed
risk.approved
execution.queued
execution.filled
flow.completed
```

Other valid paths include `context.failed`, `risk.rejected`, `execution.unknown`, `execution.rejected`, `flow.skipped`, or `flow.failed`. Live writes the Action proposal, risk approval, and outbox item atomically before calling the adapter. An unknown response is reconciled by deterministic client-order identity; it is not blindly resubmitted.

Trigger identity includes the deployment, Strategy revision, Trigger, and occurrence—not the mutable universe revision. Retrying an occurrence after a listing refresh keeps the first persisted universe as evidence. Live risk atomically reserves unsettled outbox exposure across ingestion calls and restarts, including pending, claimed, unknown, and acknowledged orders. Confirmed fills move exposure back to the trusted account-position view; rejected orders release exposure, while their order-rate reservation remains until the minute window expires.

Identity components are encoded separately so colons in Trigger/Event IDs cannot collide. Durable occurrence lookup preserves already recorded parent IDs and original universe evidence when retrying across an identity-format upgrade.

The Live outbox enforces the order-rate cap again atomically when claiming a submission, using actual claim/outcome times rather than historical Trigger timestamps. Pending items progress in FIFO order as slots reopen. An in-flight claim keeps its slot even beyond a minute; completed attempts retain a conservative one-minute window from the later claim/outcome time. A throttled item remains pending, without an attempt or submission audit, for the ingestion/execution integration to retry.

Live persists `execution.queued` before submission. An acknowledgement leaves the child open; only confirmed fill or terminal rejection/cancellation can finish it, and all actions in a child must be terminal. Hyperliquid trade fragments require order-status confirmation before they count as full fills. A validated close without `percent` means 100% in Backtest, Paper, and Live.

Terminal partial fills are distinct from both complete fills and zero-fill failures. They persist cumulative filled quantity, original quantity, and executed notional when the trade evidence covers that quantity. A partial cancellation/rejection closes the action but fails the child once every other action is terminal. Its unexecuted exposure reservation is released; filled exposure remains reserved until a trusted `RiskAccountState.positionsObservedAt` snapshot at or after the outcome transfers that exposure into account positions. Without complete fill-value evidence, the reservation conservatively retains the original intended notional. An absent, invalid, or future snapshot timestamp never releases that protection.

Hyperliquid reconciliation queries only unsettled client-order identities when available. Status queries run with at most four concurrent requests, including the legacy fills-based fallback. A failed individual lookup remains unproven without discarding independently confirmed outcomes for other orders; raw provider errors are not returned or persisted.

The renderer receives bounded, typed summaries. Credentials, raw provider payloads, and raw provider errors are excluded from audit records and UI output. Use **Logs** to inspect Paper execution. Parent/child Backtest traces appear from the Backtest result; durable Live records remain available to recovery and reconciliation services.

Paper Logs group Trigger parents and market children like Backtest traces, with bounded Condition, Action, risk, and execution detail. Main, browser Preview, and Paper Logs share the same safe detail allowlist.

## Legacy compatibility and repair

Database migration assigns `dex: hyperliquid` to existing Bots and retains their former pair as a private legacy market hint. The public Bot model exposes DEX, not the old market field.

Existing Strategy `1.0` documents keep fixed-market semantics using that trusted hint. Existing record-version-1 deployments retain their immutable `marketBindings`, remain readable, and can be stopped. Migration does not silently rewrite or approve a Strategy 2.0 revision. To adopt dynamic markets, create a new revision in Chat, inspect and Backtest it, then explicitly approve it.

The version-1 position predicate still honors its explicit `config.market`; version 2 uses `currentMarket` and forbids a symbol override. Legacy saved Backtests are projected for display without rewriting their summary or trace artifact. Unrecorded coverage and realized PnL remain unavailable, per-market attribution stays empty, and old traces are not given invented parent linkage.

Migrations are transactional and verify foreign keys before recording completion. If migration fails, Catbots closes the failed database and opens a restricted **Local database needs repair** screen. Existing records remain unchanged. Quit Catbots, restore or repair the local database outside the running application, and reopen it; the repair screen intentionally exposes no raw SQL, database path, or provider error.

Restart preserves Bot DEX identity, approved revisions, Backtest records, deployment records, and audit logs. The current release does not automatically rehydrate an in-memory Paper adapter position/order ledger after restart. Treat a persisted running Paper record as recovery state and stop or restart Paper explicitly rather than assuming local simulation resumed.

After restart, the Paper view returns its durable deployment and logs with `state: null`. The Workbench displays **Paper runtime unavailable**, explains that positions/orders were not restored, and keeps **Stop** available. It does not display an empty fabricated position ledger or claim that Paper resumed.

## Extending adapters and data products

DEX integrations implement the venue-neutral [`PerpDexAdapter`](../packages/execution-core/src/adapter.ts). Keep venue calls in an adapter or coordinator, normalize market metadata and order/event shapes, and preserve the invariant that the adapter never selects a market for a Strategy Action. Extend the closed DEX identifier and renderer-safe contracts deliberately; one Bot still belongs to exactly one DEX.

Data products enter the deterministic runtime through typed Evaluation Context references and [`NodeDefinition.requirements`](../packages/strategy-runtime/src/node-registry.ts). A provider adapter must attach observation time, freshness, quality, and integrity identity. Conditions consume those values; external marketplace Events remain data inputs and cannot bypass `currentMarket`, Risk Engine, or execution audit rules. The current catalog is curated and does not include third-party seller, payment, or publishing workflows.

Implementation and protocol references:

- [DEX-scoped dynamic-market design](superpowers/specs/2026-09-05-dex-scoped-dynamic-markets-design.md)
- [TCA product specification and data-catalog model](superpowers/specs/2026-09-03-tca-perp-bot-design.md)
- [Hyperliquid API documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
- [Hyperliquid market and account information endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Hyperliquid exchange endpoint and signing guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
