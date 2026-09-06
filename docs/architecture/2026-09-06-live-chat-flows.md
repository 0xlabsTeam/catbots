# Live packaged flows in bot chat

The reference is Cloudflare OS's ChatInterface.tsx:
https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-frontend/src/ChatInterface.tsx

That interface distinguishes streamed edit previews from accepted changes. Catbots currently implements accepted changes: each successful edit operation is saved before a bot/request-scoped flow_updated event is published. It does not render incomplete tool-argument tokens or implement Cloudflare's preview protocol.

AI uses get_flow to discover versioned package definitions and the current graph, edit_flow to add/update/remove nodes and connect/disconnect typed ports, and validate_flow to check all required inputs and the DAG. A batch contains at most 32 operations. Earlier successful operations remain saved if a later operation fails. The model must re-read the version before retrying.

Drafts are stored beside the installed node catalog in a .chat-flows.json sidecar, shared by local web and desktop. Synchronous atomic file replacement provides single-process updates; this is not a distributed storage service. Optimistic versions reject stale writes. Reload retrieves the latest draft. There is no SSE event replay buffer; reload recovers a missed draft update.

The chat workspace renders saved partial graphs before the final assistant response. Stopped or failed builds remain marked Building. Validation checks structure and configuration, not financial safety or backtest performance. Packaged flows do not enter legacy revision approval, backtesting, Paper or Live execution. Existing deployments retain their stop controls.

Verification covers incremental publication, partial failure recovery, persistence/reload, stale versions, typed wiring, and frontend updates before the send promise resolves. A configured reachable AI provider is still necessary for a real end-to-end chat demonstration.
