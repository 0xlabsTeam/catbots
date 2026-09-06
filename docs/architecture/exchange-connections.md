# Exchange connections

Connections use a dedicated contract and `connections:command` transport shared by desktop IPC and the authenticated local web backend. They do not use AI-provider or node-package credentials.

An `ExchangeAdapter` owns its descriptor, supported environments, account identity normalization and discovery. `ConnectionsService` receives a registry of adapters; UI reads their descriptors. Hyperliquid is the first implementation, with a public-address read-only authentication method. A second injected test adapter verifies case-sensitive non-EVM account identities work without service/UI changes. No unimplemented exchange appears in the platform picker.

Connection records and trading accounts are separate: each saved connection has a stable UUID, platform/environment, user label, owner identity, permission, successful snapshot time and discovered accounts. Duplicate owners are scoped by platform/environment. Atomic local storage is shared by web and desktop. Refresh failures preserve the previous snapshot; partial discovery never replaces it with zero balances. Hyperliquid checks the owner role, discovers subaccounts and queries each account's own clearinghouse state. Withdrawable collateral is labeled withdrawable, not available margin or a bot budget.

## Scope and execution boundary

This implements account discovery and a Connections UI, not delegated trading authorization. Public addresses do not verify ownership. `trading: false` and `view-only` reflect the installed adapter's actual capabilities. API-key/OAuth/wallet are authentication vocabulary for future adapters, not working login buttons. No secret is collected or exposed to the agent.

The existing legacy execution and historical backtest paths remain Hyperliquid-specific. They have NOT been migrated to an execution adapter or bound to these connections. Removing a saved connection therefore does not stop a deployment or revoke an exchange credential. These limits are stated in the UI.

Next integration must introduce credential references, verified per-account permissions, and immutable deployment execution targets (adapter, environment, connection, account, market). Before enabling trading, validate required workflow capabilities against both adapter and account and reject unsupported operations. Do not use the currently viewed account as the target for a running deployment. Separate data-source identity from execution target in backtest provenance. Authorization, credential revocation and bot stopping must remain distinct operations.

## Wallet authorization (implemented)

Hyperliquid connections now support backend-generated named API wallets for Testnet and Mainnet. `prepare_authorization` persists the generated key using Electron safeStorage before returning public EIP-712 approval data. The renderer requests a signature from the connected EIP-1193 wallet; it never receives the generated private key. The signing domain uses Arbitrum (42161) while `hyperliquidChain` explicitly binds approval to Mainnet/Testnet. Named approvals expire after 30 days; pending signatures expire after ten minutes. The backend reconstructs the signed action, recovers and checks the main-wallet signer, submits only to a fixed environment host and verifies `extraAgents` before recording authorization. Refreshing approval reuses the generated agent key to avoid losing access after uncertain network responses. Check authorization handles revocation/expiry and exposes the last successful check time.

Both web and desktop share the encrypted file. Desktop can open the running local web workspace for extension-wallet signing; the development web server must be running (`dev:all`). Packaged desktop browser handoff is not implemented by the existing dev-only web server. Hardware/mobile WalletConnect is not implemented; current signing uses an injected browser wallet. Removing a connection does not revoke exchange authority; encrypted credentials are retained for recovery, not exposed in UI or chat. Exchange-side revoke remains necessary. No order is sent by approval. Existing live deployments are still not wired to this credential store.

Verification uses freshly generated test wallets to cryptographically sign approvals for each environment, rejecting the wrong owner, expired approvals and revoked agents. No user key or live account signature was used in automated tests.
