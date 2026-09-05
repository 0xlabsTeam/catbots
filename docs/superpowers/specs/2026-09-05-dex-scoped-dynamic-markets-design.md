# DEX-Scoped Bots With Dynamic Markets

**Date:** 2026-09-05  
**Status:** Approved design  
**Initial DEX:** Hyperliquid  
**Product rule:** One Bot belongs to one DEX and may trade any perpetual market supported by that DEX.

## 1. Problem

Catbots currently requires a single `market` when a Draft Bot is created. That value is stored on the Bot and then reused by Agent prompts, sample Backtests, Paper execution, Live deployment, and risk defaults. This makes the Bot itself equivalent to one trading pair.

The intended product model is different: a Bot is a strategy workspace for one DEX. Its Strategy may trade one pair, several pairs, or choose pairs dynamically from the DEX universe. Market selection belongs to Strategy evaluation and deployment safety, not Bot identity.

## 2. Product Decisions

- One Bot selects exactly one DEX.
- The first supported DEX is `hyperliquid`.
- Creating a Bot requires only a name and DEX. It never requires a market.
- The DEX field remains a real single-select even while it contains only Hyperliquid. It has no placeholder or “coming soon” message.
- A Bot may evaluate and trade any active perpetual market returned by its selected DEX.
- New listings become eligible automatically when the DEX universe refreshes.
- A delisted or inactive market cannot receive a position-increasing order. Position-reducing and closing actions remain permitted when the venue supports them.
- The Agent collects fixed-market, multi-market, and market-screening requirements through Chat and expresses them as Conditions.
- In ordinary trading language, “sell ETH” means close an existing ETH long position. Opening a short position requires explicit short intent.

## 3. Domain Model

### 3.1 Bot

The public Bot model becomes:

```ts
type Bot = {
  id: string;
  name: string;
  dex: 'hyperliquid';
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
};
```

`CreateDraftBotInput` contains `{ name, dex }`. It does not contain a market, symbol, pair, or market list.

DEX identifiers are adapter identifiers, not display names. Adding another DEX extends the closed identifier registry and does not change the Bot shape.

### 3.2 Strategy market context

New Strategy Documents use schema version `2.0` and declare dynamic DEX scope:

```json
{
  "schemaVersion": "2.0",
  "strategy": {
    "id": "eth-rsi",
    "name": "ETH RSI",
    "version": 1
  },
  "marketScope": {
    "type": "dex_universe"
  },
  "nodes": [],
  "edges": []
}
```

`marketScope` describes the candidates supplied to evaluation. It does not grant execution permission by itself. Version 2 initially supports only `dex_universe`; future optimization modes may narrow candidates without changing Flow semantics.

Each evaluation receives an immutable `currentMarket` from the Bot’s DEX universe. Registered market and indicator data references resolve against that market, including:

- `market.symbol`
- `market.price`
- `market.funding`
- `market.volume`
- `market.rank`
- indicator values such as RSI for the current market and timeframe

An explicit pair is represented by a normal Condition such as `market.symbol = ETH`. No new node kind is introduced.

### 3.3 Deployment market access

Bot DEX identity and deployment venue are separate concepts. Paper simulates the selected DEX; Live uses the selected DEX adapter.

```ts
type MarketAccess = {
  mode: 'all_active_perpetuals';
};

type Deployment = {
  botId: string;
  dex: 'hyperliquid';
  mode: 'paper' | 'live';
  executionVenue: 'paper' | 'hyperliquid';
  marketAccess: MarketAccess;
  // approved strategy identity, risk limits, status, and timestamps
};
```

The existing fixed `marketBindings: string[]` contract is replaced by `marketAccess`. Limits for size, leverage, daily loss, drawdown, direction, and order rate remain mandatory.

## 4. Flow Semantics

The visual and executable grammar remains `Trigger → Condition → Action`.

### 4.1 Interval Trigger

An interval occurrence creates one parent run and fans out into one evaluation per active market in the current DEX universe. Each child evaluation has its own `currentMarket`, point-in-time data, result, proposed effects, and audit trace.

### 4.2 Event Trigger

A market-scoped Event evaluates only the market carried by the Event. A DEX-wide Event may fan out when its registered definition explicitly permits that behavior. External marketplace Events without a market remain DEX-wide data and do not invent a market identity.

### 4.3 Conditions

Conditions read the current market and injected data. Existing combiners (`ALL`, `ANY`, `NOT`, and `AT LEAST`) continue to work. Common strategies are expressed without special market nodes:

```text
Every interval
→ Market symbol = ETH AND RSI < 20 AND ETH position is flat
→ Open long on current market

Every interval
→ Market symbol = ETH AND RSI > 80 AND ETH position is long
→ Close current-market position
```

A broad screener omits the symbol equality and uses market-relative data such as rank, volume, funding, or indicators.

### 4.4 Actions

Execution Actions inherit `currentMarket`; the model cannot inject a different symbol after Conditions have passed. The runtime stamps the market onto the proposed effect before the effect reaches the Risk Engine. An explicit cross-market Action is outside this design.

This binding prevents a Strategy from checking ETH and then submitting an order for an unrelated market in the same evaluation.

## 5. Runtime and DEX Adapter

The DEX adapter is the authority for tradable-market metadata. The execution coordinator obtains and caches a normalized universe containing at least symbol, active state, size precision, and maximum leverage.

- Universe refresh occurs at startup, before deployment, and periodically while running.
- A refresh has a bounded freshness policy. Stale or unavailable metadata blocks position-increasing Live actions.
- Newly active markets become evaluation candidates after a successful refresh.
- Removed or inactive markets are excluded from new-entry evaluation.
- Existing positions on inactive markets remain visible to position and close logic.
- Every submitted effect must use the same DEX as its Bot and deployment.

The strategy runtime remains deterministic and side-effect free. An outer coordinator performs market fan-out and supplies immutable evaluation contexts. Network calls remain in data and DEX adapters, never in Condition or Action nodes.

## 6. Backtest

The Backtest Tool changes from a single `market` request to a market universe request:

```ts
type BacktestMarketUniverse =
  | { mode: 'all_available' }
  | { mode: 'include'; markets: string[] };
```

`all_available` means all markets present in the selected point-in-time dataset, not today’s live universe. This prevents look-ahead bias. `include` is an execution optimization for strategies whose Conditions explicitly name markets; it does not modify the Strategy.

Backtest behavior:

- Replay market membership and metadata as they existed at each timestamp.
- Evaluate interval flows per eligible market and event flows for their event market.
- Maintain one shared portfolio, account equity, risk state, and order-rate budget across all markets.
- Apply fees, funding, margin, liquidation, and fills per market through the simulated DEX adapter.
- Produce aggregate Bot metrics plus per-market PnL, trades, win rate, drawdown contribution, and trace access.
- State exactly which markets and date range the dataset covered.

Bundled sample data may cover only a small fixture universe, but the UI must label that limitation. It must not claim to represent all Hyperliquid markets.

## 7. Risk and Execution Safety

For every proposed order, the Risk Engine validates:

1. Bot, Strategy revision, deployment, and DEX identities match.
2. The proposed market equals the evaluation’s `currentMarket`.
3. Fresh adapter metadata confirms the market belongs to the selected DEX.
4. The market is active for position-increasing orders.
5. Side, order size, total market position, total portfolio exposure, leverage, loss, drawdown, and order-rate limits pass.
6. The proposal and decision are durably audited before any venue request.

`all_active_perpetuals` means all valid markets on the selected DEX; it never means arbitrary symbols or another venue. A DEX universe update does not bypass risk checks.

When metadata is unavailable or ambiguous, the safe result is no new order. Stop and close controls remain available whenever their venue operation can be proven position-reducing.

## 8. Audit Model

Every execution flow remains fully logged. A parent trigger run records the DEX and universe revision. Each market evaluation records:

- market identity and metadata revision;
- point-in-time input references and freshness;
- each Condition result, including `true`, `false`, or `unknown`;
- the Action proposal with its bound market;
- the Risk Engine decision;
- outbox, adapter, acknowledgement, fill, reconciliation, and terminal results.

Parent and child trace identifiers allow the UI to show one interval run without losing per-market detail. Secrets and raw provider errors are never placed in audit records.

## 9. UI

### 9.1 Create Bot

The dialog contains exactly:

1. `Bot name`
2. `DEX` single-select, initially containing only `Hyperliquid`
3. `Cancel` and `Create draft`

The dialog contains no Market field and no message about future DEX support.

### 9.2 Bot list and Workbench

- Bot rows display DEX instead of Market.
- The Workbench header displays `Hyperliquid · Dynamic markets`.
- Chat collects market requirements and explains whether the resulting Conditions select one market or screen the full universe.
- The graph continues to render only Trigger, Condition, and Action nodes.
- A compact graph header displays the DEX and market scope without creating a fourth node kind.

### 9.3 Backtest and deployment review

- Backtest shows aggregate metrics first and a per-market breakdown second.
- Paper and Live review show `DEX: Hyperliquid` and `Market access: All active perpetual markets`.
- Live review lists risk limits and universe freshness before confirmation.
- The user never selects one fixed pair merely to create a Bot.

## 10. Agent Behavior

The Agent receives the Bot DEX and dynamic-market semantics in its system context. It must:

- ask for market intent when the requirement is ambiguous;
- use a symbol Condition when the user names a specific pair;
- use current-market data Conditions for screeners;
- treat ordinary “buy” as opening/increasing Long unless the user says otherwise;
- treat ordinary “sell” as closing/reducing an existing Long unless the user explicitly requests Short;
- explain when a Strategy can create positions in multiple markets;
- never represent Backtest coverage as broader than its dataset.

The Agent cannot approve a Strategy revision or Live deployment on the user’s behalf.

## 11. Migration and Compatibility

Migration must preserve existing Bots and all related Strategy, Backtest, deployment, outbox, and audit records.

1. Add the Bot DEX identity and assign `hyperliquid` to existing Bots.
2. Preserve each legacy Bot market as a compatibility hint associated with that Bot.
3. Rebuild the Bot storage shape without exposing `market` in the new public Bot contract.
4. Continue evaluating Strategy schema `1.0` with its legacy single-market hint.
5. Generate new or migrated Strategy revisions as schema `2.0`.
6. Moving a legacy Strategy to dynamic markets requires a new revision and explicit user approval. It never happens silently during database migration.
7. Existing deployments retain their immutable market bindings and old execution semantics until stopped. New deployments use `marketAccess` and schema `2.0`.

The migration is transactional. A failure leaves the previous schema and records intact and routes the app to a safe repair state.

## 12. Error Handling

- DEX universe unavailable: show a fixed safe error and block new deployment or entry actions.
- Market data missing or stale: Condition becomes `unknown`; no Action runs through that path.
- Market inactive: reject increases; allow only proven reduction/close behavior.
- Unsupported Strategy version: block evaluation and preserve the document for repair.
- Backtest dataset lacks a required market: fail or report incomplete coverage explicitly; never substitute another market.
- DEX mismatch between Bot and deployment: reject before durable outbox creation.

## 13. Test and Acceptance Criteria

### Contracts and storage

- Creating a Bot accepts `{ name, dex }` and rejects market fields.
- Bot summaries contain DEX and no market.
- Existing Bot records migrate without loss and retain legacy behavior.
- Existing deployments remain readable and stoppable.

### Strategy and runtime

- An interval flow evaluates every eligible market with isolated current-market data.
- An Event flow evaluates only its event market.
- A symbol Condition restricts Actions to that symbol.
- An Action cannot emit a market different from its evaluation context.
- Combined Conditions behave identically under multi-market fan-out.

### Backtest

- Multi-market replay uses point-in-time universe membership and one shared portfolio.
- Aggregate metrics equal the reconciled per-market results and shared account changes.
- Missing coverage and stale data remain visible and safe.

### Paper and Live

- Paper simulates the Bot’s selected DEX across multiple markets.
- Live accepts only markets proven active by fresh Hyperliquid metadata.
- Newly listed markets become eligible after refresh.
- Delisted markets reject increases but preserve safe close handling.
- Every market evaluation and execution transition has a durable audit trail.

### UI and end-to-end

- Create Bot shows only name and one DEX selector.
- A user can describe the ETH RSI example, review its two Flows, Backtest it, approve it, and run Paper without having selected ETH during Bot creation.
- Live review communicates DEX-wide market access before confirmation.
- Restart preserves the Bot DEX, approved revision, deployments, and logs.

## 14. Non-Goals

- One Bot executing across multiple DEXs.
- Cross-DEX arbitrage or routing.
- Spot, options, or non-perpetual products.
- An Action targeting a different market from its evaluation context.
- Mainnet enablement as part of this change.
- Automatically rewriting or approving legacy Strategy revisions.
