# Exchange connections

Connections use a dedicated contract and `connections:command` transport shared by desktop IPC and the authenticated local web backend. They do not use AI-provider or node-package credentials.

An `ExchangeAdapter` owns its descriptor, supported environments, account identity normalization and discovery. `ConnectionsService` receives a registry of adapters; UI reads their descriptors. Hyperliquid is the first implementation, with a public-address read-only authentication method. A second injected test adapter verifies case-sensitive non-EVM account identities work without service/UI changes. No unimplemented exchange appears in the platform picker.

Connection records and trading accounts are separate: each saved connection has a stable UUID, platform/environment, user label, owner identity, permission, successful snapshot time and discovered accounts. Duplicate owners are scoped by platform/environment. Atomic local storage is shared by web and desktop. Refresh failures preserve the previous snapshot; partial discovery never replaces it with zero balances. Hyperliquid checks the owner role, discovers subaccounts and queries each account's own clearinghouse state. Withdrawable collateral is labeled withdrawable, not available margin or a bot budget.

## Scope and execution boundary

Connections provide account discovery, delegated API-wallet authorization and execution targets. Public addresses alone do not verify ownership. Signing credentials remain backend-only and never enter agent tools or renderer state.

Schema 3.0 execution uses `FlowRunner` and `FlowVenue`. The legacy schema 2.0 runtime remains a separate path; do not run another trader on an account assigned to this runtime.

## Wallet authorization (implemented)

Hyperliquid connections now support backend-generated named API wallets for Testnet and Mainnet. `prepare_authorization` persists the generated key using Electron safeStorage before returning public EIP-712 approval data. The renderer requests a signature from the connected EIP-1193 wallet; it never receives the generated private key. The signing domain uses Arbitrum (42161) while `hyperliquidChain` explicitly binds approval to Mainnet/Testnet. Named approvals expire after 30 days; pending signatures expire after ten minutes. The backend reconstructs the signed action, recovers and checks the main-wallet signer, submits only to a fixed environment host and verifies `extraAgents` before recording authorization. Refreshing approval reuses the generated agent key to avoid losing access after uncertain network responses. Check authorization handles revocation/expiry and exposes the last successful check time.

Both web and desktop share the encrypted file. Desktop can open the running local web workspace for extension-wallet signing; the development web server must be running (`dev:all`). Packaged desktop browser handoff is not implemented by the existing dev-only web server. Hardware/mobile WalletConnect is not implemented; current signing uses an injected browser wallet. Removing a connection does not revoke exchange authority; encrypted credentials are retained for recovery, not exposed in UI or chat. Exchange-side revoke remains necessary. No order is sent by approval. Schema 3.0 deployments retrieve verified credentials from this store when explicitly started.

Verification uses freshly generated test wallets to cryptographically sign approvals for each environment, rejecting the wrong owner, expired approvals and revoked agents. No user key or live account signature was used in automated tests.

## Workflow execution

Deploy saves a connection/account/market and independent USD order/position ceilings. Network comes from the connection. Check readiness reads account authorization, flow capabilities, market and collateral without sending orders. Start requires the current valid flow version and an explicit network/market confirmation. Backend preflight runs again; the deployment pins its document and target. Target changes are blocked during start and execution.

The Hyperliquid venue routes Testnet/Mainnet explicitly and sets the subaccount vault address when applicable. Standard and unified accounts are supported; portfolio-margin accounts are rejected. Market IOC actions, DCA and smart-order controllers are supported. Grid/resting-limit controllers, cancellation processors and persistent output nodes are rejected before deployment. This is not full parity with the backtest runtime.

The runner compiles once per deployment and evaluates once per shortest requested candle interval, or every minute with no candles. Its first evaluation occurs after Start. Candle requests use the selected exchange network and closed-candle loader. Each order gets a fresh account/price snapshot, market precision, minimum-notional and exposure checks. IOC price tolerance is 0.5%; checks reserve 0.6% for tolerance/rounding. Existing open orders block execution. One active bot is allowed per account or API-wallet connection in this runtime.

State and deterministic client order IDs are atomically journaled before dispatch. Confirmed fills and fees feed the next evaluation; IOC remainder completion clears pending controller state. Unknown outcomes halt execution and block account restart rather than resubmitting. Reconcile queries the exchange by client order ID and only accepts terminal outcomes with complete matching fills. Unknown or incomplete results remain blocked; reconciliation never resends an order. Legacy pending records without the original order plan still require manual reconciliation. Restarted processes mark deployments interrupted and do not resume automatically. Stop awaits an in-flight request, stops future evaluations and leaves positions open. There is no background execution after the backend closes.

Tests use a fake venue and generated authorization wallets, including order limits, duplicate prevention, DCA fill feedback, shutdown and uncertain outcomes. No real exchange order was submitted during implementation. Legacy runtime and external/manual traders do not participate in the account lock; use a dedicated account/subaccount.

## Runtime hardening

- DCA risk evaluation runs every five seconds independently of candle/signal intervals. It consumes fills and checks TP/SL without activating entries, averaging or smart-order slices. This is backend-managed protection, not an exchange-hosted stop; it needs a running backend and working connection. Other custom exit conditions retain their signal interval.
- Identical document/version/target resumes the existing deployment ID, fills and state after checking the exchange position matches the journal. A different deployment requires a flat market position. External changes fail closed. Prior deployments are archived in `.history`; older overwritten runs cannot be recovered retroactively.
- Entry ceilings and minimums do not block validated reduce-only orders. Exchange precision, position direction and actual quantity checks still apply. Exchange-side rejection remains authoritative.
- Static DCA order sizing includes tolerance, and controller maxNotional must fit the target. Dynamic order checks remain active at dispatch; readiness is not a guarantee that future signals can trade.
- Definitive SDK/API rejections are distinct from unknown transport outcomes. Unsent proposals are cleared from controller pending state on stop/failure so Resume does not wait for fills that cannot arrive.
- Closed candles are cached per network, symbol and timeframe, refreshed incrementally at a new candle boundary. Price and account state remain fresh. Metadata has a five-minute cache. Cache size is bounded to 32 series and 5,000 candles each; the existing candle validation still runs.
- Performance and Logs read the new runtime journal, including run history, fees, realized trading PnL (excluding funding), exchange order IDs and the latest node input/output trace. Missing legacy fee/side data is shown as unavailable rather than zero. History currently uses atomic JSON files, not a scalable database event store.

## Native protection and credential rotation

The Hyperliquid venue now implements exchange-hosted DCA protection. Each confirmed position size/entry change generates fixed-size reduce-only SL/TP orders. The journal records planned/unknown/open/terminal states before I/O. Unknown submissions are inspected by client ID and never blindly resent. New protection is confirmed before old protection is canceled. Unrelated exchange orders continue to block this runner; owned protective orders are recognized by exchange ID.

A single DCA controller is supported per protected workflow. Native exits stop the run and reconcile filled quantity/fees; full close cancels remaining siblings. Resume explicitly starts another cycle. Partial exits are protected at the remaining size, then blocked for reconciliation. Stop and backend shutdown preserve exchange-hosted orders. Protection is installed after an entry fill, so there is a non-atomic exposure window; installation failure is surfaced and stops further entries. This does not claim atomic bracket entry or full Grid support.

Authorization now stores encrypted active and pending slots. New challenges generate new addresses; only the same outstanding ten-minute challenge is reused. Verification atomically promotes a pending signer, retaining previous keys for recovery. It does not revoke older exchange approvals. Existing credentials migrate without losing the active key. No active bot may rotate its connection credential. Old-agent revocation remains an explicit owner-wallet operation.

Verification includes active-key continuity, fresh-key promotion, expired challenges, native trigger payloads, replacement ordering, ambiguous submissions and native-fill lifecycle. Development tests use a fake exchange and do not authorize a new user wallet or place real triggers.
