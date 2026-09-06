# Historical backtests for packaged flows

## Entry point and architecture

Open a bot with a saved packaged flow → Backtest. Web and Electron share the local backend. The saved flow version is pinned on submission. The API returns a job immediately, the UI polls every 750 ms, and Cancel aborts loading for that waiter or terminates its compute worker. Leaving the tab does not destroy the job; its ID is kept in session storage. Backend restart clears active job IDs; submitting again can restore a cached completed result.

`FlowBacktestService` → `HistoricalFlowLoader` → data disk cache → bounded `worker_threads` replay → result disk cache. No renderer-side historical fetch or exchange credentials are involved. Legacy schema 2.0 still uses the existing explicitly labeled bundled sample replay; its AI tool refuses to substitute a legacy sample run for a packaged flow.

## Data integrity

- Hyperliquid mainnet `candleSnapshot` and `fundingHistory`, not generated prices.
- OHLCV source supports only the latest 5,000 candles per interval. The requested range plus warm-up must fit and be fully present; older or gapped history fails rather than silently shortening the run.
- Validate interval, symbol, timestamps, chronological continuity, OHLC relationships, positive prices, finite values and hourly funding coverage. Open candles are excluded. Dates are aligned UTC with an exclusive end.
- Indicator warm-up follows the actual downstream graph. Multiple intervals are merged by closed timestamp; a slower candle is invisible until its close.
- Funding responses can be published milliseconds after the hour. Preserve `reportedAt`, assign the rate to the hourly settlement bucket, and reject unexpected delays of a minute or more. Prices for funding are the prior candle close, an explicit mark-price proxy.

Sources: [Hyperliquid info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [API rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).

## Execution model

Engine `ohlcv-next-bar-v2`:

1. Apply hourly funding to the position held before the opening boundary.
2. Process orders produced on earlier bars. Market orders use the next open plus adverse slippage. Marketable limit orders use the open with slippage bounded by the limit; other touched limits fill at the limit. An order produced at this bar's close cannot fill within that bar.
3. Validate reduce-only direction and cap reductions to inventory held at the opening boundary, preventing same-bar exits of newly opened inventory. Reject exposure above 1× available equity. Send actual fill/cancel acknowledgements into the next node evaluation and retain strategy state across bars.
4. Expose only closed candles, calculate indicators and evaluate the pinned graph. EMA, RSI and ATR retain smoothing state instead of reseeding at each sliding window. Missing intermediate history stops the replay.
5. Mark equity at the close. Do not force a final close or fabricate fills for pending orders.

Fees apply to every fill; funding is signed (positive is a payment, negative a receipt). Realized PnL is gross before fees/funding. Equity reconciles as starting capital + realized + unrealized − fees − funding. Drawdown is measured at bar closes. The result stores the exact flow, settings, engine, source timestamps and content hashes.

This is an OHLCV simulation, not an exchange matching engine. No leverage/liquidation, hedge mode, queue priority, order-book liquidity, exchange lot-size/minimum-notional enforcement, or exact intrabar order sequencing is claimed. Limit fill times are displayed in their candle's opening-time bucket. The UI displays these limitations alongside results. It does not enable Paper/Live deployment.

## Performance and cache

- Compile topology and parse node configuration once. Index incoming edges. Advance candle cursors incrementally and keep bounded windows.
- Historical evaluations omit full per-node JSON traces; accumulate node coverage counts instead. This avoids retaining thousands of copied candle arrays. The UI pages fills by 50 and samples the equity chart while metrics use all bars.
- At most two concurrent jobs, each with a 256 MB worker heap and 120 second compute timeout. At most 5,000 bars, four candle intervals, 20,000 fills, 1,000 pending orders and 100 million estimated node×bar×window operations.
- Data cache TTL: one hour. Key: provider/version, market, exact UTC range and per-interval warm-up requirements. Requests sharing this key coalesce; cancelling one waiter does not interrupt another. Shared fetches have a 60 second deadline and bounded retries for 429/5xx.
- Result cache TTL: 24 hours. Key includes engine version, package/node versions, canonical complete flow, all assumptions, and the content hash of actual candles/funding. Layout coordinates are not strategy inputs. Fees, graph changes or changed historical data invalidate results. Refresh explicitly bypasses both caches.
- Each disk cache is capped at 32 files / 64 MB, evicted oldest-first. Checksummed values, atomic rename, private files and temporary-file cleanup protect against interrupted writes. Cache I/O failure does not fabricate results or fail a valid computed run.
- Keep up to 20 job records in memory. Result cache survives restart; it is a cache, not a permanent backtest-history archive. Version changes to replay semantics must bump the engine identifier. The host rejects a worker compiled with a different identifier.

## Validation

Runtime tests cover next-open execution, fee/funding reconciliation, long/short behavior, future-data isolation, missing bars/warm-up/funding, adverse slippage, exposure rejection, terminal positions/pending orders, deterministic state, rolling EMA continuity, slower timeframe visibility, and Grid limit fills. Cache/service tests cover coalescing, per-waiter cancellation, corrupt/expired entries, eviction, settings/flow invalidation, refresh, job joining and ownership. UI tests cover version-pinned submission, provider errors, cancellation/resume and unsaved-configuration blocking.

Live browser test on an existing ETH flow, 7 days / 168 hourly bars: 4 fills; 670 ms compute in the measured run. Repeating the same request returned identical equity from cache in approximately 68 ms including UI response. These are observations on this machine, not latency guarantees. Cancellation, desktop/mobile bounds and no browser errors were verified. Screenshots: [Desktop](desktop.png), [Mobile](mobile.png).

Final checks: strategy-runtime suite 171 tests passed; selected desktop/service/UI regression suites 28 tests passed; full workspace typecheck/design-system checks and renderer build passed. The renderer retains the existing bundle-size advisory. The live check exercised the actual bundled backtest worker through the shared Electron/web backend.

## Agent backtesting and tuning

The chat agent now shares `NodePackageService.backtestCommand` with the web/desktop Backtest panel. Tools:

- `run_flow_backtest(version, settings, refresh?)`: starts a pinned saved flow, waits asynchronously for completion, and publishes progress. Each chat turn permits at most five starts; active jobs also retain the shared concurrency limits.
- `get_flow_backtest(jobId, offset?, limit?)`: reads status, metrics, dataset and flow hashes, assumptions, warnings, node coverage and paginated fills (20 by default, at most 100). Full documents and equity series stay out of model tool output.
- `cancel_flow_backtest(jobId)`: cancels a job owned by the current bot. Stopping chat cancels the job currently awaited by its run tool.

Historical completion does not terminate the agent turn: it can inspect results, call existing version-checked `edit_flow` and `validate_flow`, and run the changed workflow. Legacy sample backtests keep their original review boundary. Historical tuning permits 24 tool rounds (ordinary turns retain eight).

The prompt requires a baseline, small explainable changes, unchanged cost/risk assumptions, comparable data/settings, reporting regressions, and chronological holdout where history permits. These are model instructions, not an exhaustive optimization algorithm or statistical guarantee. The five-run budget and input/ownership validation are enforced in code. Results and pinned documents remain in the existing bounded job/cache service; job IDs are not durable across backend restart. The agent should include job IDs and versions in its report for later inspection.

Verification: deterministic agent-loop test proves historical completion → inspection → edit → validation → rerun → final response; service/tool tests cover cancellation, schemas, pagination, budget and backend error propagation. This verifies tool wiring without asserting that every configured external model will choose good tuning parameters.
