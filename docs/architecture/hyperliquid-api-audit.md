# Hyperliquid API contract audit

Reviewed 2026-09-06 against the official documentation and the installed `@nktkas/hyperliquid` SDK. This is a contract comparison, not certification of Mainnet readiness. No orders or authorization changes were made for this audit.

## Exchange requests

Source: [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint).

For validator-operated perpetuals, asset IDs come from `meta.universe`; they are not interchangeable with spot IDs. The current venue supports these perps only. HIP-3 and spot need explicit namespaces and collateral mappings.

IOC cancels any unmatched remainder. A submit response must not be interpreted as a full fill. Keep partial quantity, fees and terminal remainder separately. Our controller feedback clears IOC pending state after consuming confirmed fills.

Subaccount orders use the target account as `vaultAddress`. Read requests use the actual account address, not the signing API wallet. Existing implementation follows this distinction.

Order requests now include a signed `expiresAfter` deadline of 15 seconds. This bounds delayed acceptance; it does not imply a timed-out request was rejected. Transport failures still require reconciliation. Expiration must not trigger blind retries.

## Decimal precision

Source: [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size).

Perp price decimals are limited by `6 - szDecimals`; noninteger prices also have at most five significant digits. Integer prices have an exception. Size follows the asset's `szDecimals`.

Implemented a shared base-10 quantizer. A valid lot such as 0.29 must not become 0.28 through binary floating-point flooring. Buy IOC limits round down and sell limits round up at their tolerance boundary. Payload strings avoid exponent notation and redundant decimal zeroes. This venue is not a spot precision implementation.

## Signing and wallets

Sources: [Signing](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing), [Nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).

L1 actions and user-signed approvals use different signing schemes. Continue using SDK signing for orders. A locally recovered signature alone does not prove the server will reconstruct the same payload.

Nonce scope is the signer, including when one API wallet signs for multiple subaccounts. Our one-active-bot-per-connection lock limits concurrency, but a per-account/process signer architecture is preferable for concurrent bots.

**Implemented:** active/pending encrypted credential slots, fresh keys for new or expired challenges, and promotion only after exchange verification. Existing single-record credentials migrate on read. Outstanding challenges are reused only during their ten-minute window. Prior keys remain encrypted for recovery. Old exchange approvals still require explicit revocation; key promotion does not revoke them. Rotation is blocked while this connection has a running bot. No user credential was rotated during development.

## TP/SL semantics

Source: [Take profit and stop loss](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl).

Native triggers use mark price. Position-based protection and parent-order OCO have different sizing and activation rules. A partially filled parent canceled by the user does not necessarily leave protective children active. Protection must be checked against the actual position after partial fills/cancels.

**Implemented for a single DCA execution controller:** exchange-hosted, fixed-size reduce-only TP/SL, installed after confirmed entry fills with journaled client IDs. Replacement is confirmed before canceling the previous generation. Native fills are reconciled and sibling protection is canceled after a full close. A native exit stops the run; repeat requires an explicit resume. Partial native exits retain replacement protection and block resume pending reconciliation. Stop/backend shutdown leaves native protection on the exchange. The entry-to-protection installation window is not atomic; a failed installation stops the bot with a needs-attention state. Native orders use a 10% trigger-price bound, separate from ordinary 0.5% IOC orders. These paths are covered by mocked exchange tests, not a live native-trigger execution test.

## Balances and collateral

Source: [Account abstraction modes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes).

Unified balances/holds come from spot clearinghouse state. Individual perp-DEX account value is not the aggregate balance in that mode. Existing UI and venue select spot USDC for validator-operated unified perps. Portfolio margin remains explicitly unsupported.

**Unresolved:** shared USDC balance is not a complete liquidation-risk calculation. Cross-DEX maintenance requirements and isolated margin must be considered before supporting cross-DEX portfolio risk. `withdrawable`/available-after-maintenance should not be described as a dedicated bot budget or guaranteed order buying power. Exchange margin checks remain authoritative; current local sizing is conservative, not leverage-aware.

## Fills and reconciliation

Source: [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

Use `orderStatus` with the client order ID to establish an outcome. `unknownOid` is not proof that a retry is safe. Keep uncertain requests blocked until a terminal outcome can be matched with execution data.

`userFills` returns the most recent 2,000 fills. `userFillsByTime` is also paginated, and only the latest 10,000 fills remain available. A single history call is not durable accounting. Do not double-count `builderFee`: the documented `fee` already includes it. Confirm `feeToken`, side and market when validating execution data.

**Unresolved:** the venue currently reconciles from recent `userFills`. It safely refuses incomplete totals, but older orders may remain unrecoverable through this path. Add WebSocket ingestion, deduplication by fill identity, durable storage, reconnect backfill and pagination. Preserve raw exchange facts alongside derived run metrics. Previously overwritten run history cannot be reconstructed from a new local journal alone.

## Rejections and minimums

Source: [Error responses](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses).

Order-level and whole-request errors both exist. The single-order venue distinguishes definitive API rejection from transport ambiguity. Future batching must inspect the whole response and each order separately.

The docs list a $10 minimum error and a separate reduce-only error. They do not establish a universal exemption for every small reduce-only order. Our local reduce-only path avoids blocking risk reduction with an entry ceiling, but the exchange can still reject it. Do not promise that all dust positions can close through this path. Add an explicit dust/rejection UX and verify the applicable market rules before automating retries.

## Rate limits and streams

Sources: [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits), [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).

The shared IP budget is weighted, not a flat requests-per-second limit. `userRole` is expensive; general info queries and returned candles/fills also contribute. Five-second polling across several bots can exceed the budget despite metadata/candle caching.

**Unresolved:** introduce one network-wide weighted request scheduler, bounded concurrency, rate-limit backoff and shared market/account streams. Handle subscription snapshots versus live events, reconnect and resubscription explicitly. Keep order submission retries separate from safe read retries.

## Verification and next order of work

Added precision boundary tests and an assertion that IOC requests include expiry and retain reduce-only intent. Existing runner/venue regression tests were rerun without exchange submissions.

Next: native position protection; safe credential rotation; durable fills/backfill; shared request budget and streams; then leverage and cross-DEX risk. Keep unsupported capabilities explicit until verified with adapter tests and bounded Testnet scenarios.
