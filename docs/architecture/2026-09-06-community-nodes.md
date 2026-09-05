# Community nodes: adapting Node-RED to Catbots

Status: proposal, not an implemented plugin installer. Reviewed 2026-09-06.

## Recommendation

Use Node-RED's package/registry/palette pattern, with a Catbots SDK and execution contract. Keep the current trading runtime. Do not promise drop-in compatibility with existing Node-RED packages: their message routing, editor templates, context and runtime APIs differ.

Start with installable declarative subflows composed of existing nodes. Establish the package contract by moving built-ins through the same registry path. Open executable community nodes only after defining and verifying a real isolation boundary.

## What Node-RED does

- Packages are npm modules; `package.json` has a `node-red.nodes` map of runtime entry points and can declare runtime version compatibility. One package can provide several nodes. [Packaging](https://nodered.org/docs/creating-nodes/packaging)
- Runtime node code registers a type and participates in an input/send/done/close lifecycle. [Runtime API](https://nodered.org/docs/creating-nodes/node-js)
- Editor metadata, edit templates and help are supplied in the node HTML file. This makes extension UI flexible. [Editor definition](https://nodered.org/docs/creating-nodes/node-html)
- Palette Manager exposes installation and management. Subflows can also be distributed as modules. [Palette Manager](https://nodered.org/docs/user-guide/editor/palette/manager), [Subflow modules](https://nodered.org/docs/creating-nodes/subflow-modules)
- Credentials are stored separately from exported flows. [Credentials](https://nodered.org/docs/creating-nodes/credentials)
- The loader discovers module files, checks declared Node-RED version compatibility and imports enabled node modules into the runtime. This is not an isolation boundary for untrusted code. [Loader source](https://github.com/node-red/node-red/blob/master/packages/node_modules/@node-red/registry/lib/loader.js)

## Existing Catbots seams

- `packages/strategy-runtime/src/node-registry.ts`: immutable definitions already contain kind/type/version, schemas, typed ports, visualization and data/entitlement/permission requirements. There is no package provenance or executor registration.
- `packages/strategy-runtime/src/condition-evaluator.ts`: evaluation dispatch still recognizes specific built-in type names.
- `packages/strategy-runtime/src/strategy-schema.ts`: node kinds are trigger/condition/action; ports currently use activation/condition. The dotted type identifier excludes scoped npm names. Keep package identity separate from node type rather than overloading this field.
- `apps/desktop/src/main/agent/agent-tools.ts`: a module-level built-in registry drives AI tool schemas and discovery.
- `apps/desktop/src/main/workbench/workbench-repository.ts`, deployment validation and backtest replay also construct built-in registries. All must resolve the same pinned registry snapshot for a strategy revision.
- Existing Zod schemas and summary functions are executable objects. They cannot be treated as safe metadata received from a community package.

## Proposed package

Illustrative API only; these commands and fields do not exist yet.

```text
@acme/catbots-funding-filter/
  package.json
  catbots.json
  nodes/funding-filter.node.json
  flows/funding-filter.json
  examples/eth-funding.json
  tests/replay-fixtures.json
  README.md
  LICENSE
```

```json
{
  "name": "@acme/catbots-funding-filter",
  "version": "1.0.0",
  "catbots": { "manifest": "catbots.json" }
}
```

The manifest declares SDK compatibility, exported node definition paths and artifact format. Each definition declares a stable dotted type, node definition version, kind, input/output ports, supported modes, JSON Schema config, approved icon identifier, help, examples, required data and capabilities. Declarative packages point to a bounded subflow. A future executable format would additionally declare its isolated runtime artifact.

Keep three version concepts distinct: npm package version, SDK/API compatibility, and node definition/config version. Existing built-in identifiers remain resolvable via an explicit compatibility mapping. Require publisher namespaces for new node types and reject collisions.

## One definition, three consumers

1. Editor renders config JSON Schema plus restricted UI hints into Kumo Input/Select/Switch and other approved components. Packages supply no HTML, CSS, React bundles or arbitrary summary functions. Help is sanitized Markdown; icons come from approved assets.
2. Pi gets discovery metadata and config schemas only from installed, enabled, compatible nodes. Installing documentation must not make it an agent instruction. Unknown types and absent capabilities remain validation errors. AI may propose a package but cannot silently install it or grant permissions.
3. Validator and executor use the same resolved, immutable package snapshot. The node implementation returns typed results and declared effects. The host controls scheduling, data access, scoped state, cancellation, audit and execution policy.

Preserve Trigger → Condition → Action for the first release. Reusable indicators can initially be host data products referenced by condition nodes. A general value/data port graph is a separate schema and evaluator migration; it should not be bundled into the first installer.

## Execution and reproducibility

- Declarative subflows expand into pinned existing nodes with depth/node-count limits and cycle validation. Preserve parent/child identities in traces.
- Executable plugins need constrained execution with CPU/memory/time limits and mediated I/O. A plain worker thread, child process or Node `vm` alone is not a sufficient security sandbox. Evaluate the actual enforcement mechanism before enabling arbitrary community code.
- Inject logical time and recorded market snapshots. No uncontrolled clock, random source or network access during backtest. Live-only nodes must declare their limitation and fail backtest validation clearly.
- An action returns an order intent. Catbots risk checks, approval state, position limits and execution adapters decide whether to send it. Plugins never receive trading private keys or direct signing authority.
- Store connection references in strategy config. A host broker uses credentials for permitted operations; exported flows and AI prompts do not contain secrets.
- Persist package version, integrity digest, transitive dependency closure, node definition versions and host SDK version with each revision/backtest/deployment. Replay also needs recorded input data and relevant runtime versions; a package hash alone is insufficient.
- Updates create a new dependency snapshot and require revalidation/backtest before redeployment. Never replace code under a running deployment. Retain old artifacts for historical replay. Missing artifacts block execution while preserving graph visibility.

## Installation and UX

Add Nodes to the navigation with Installed and Discover views. Package detail shows publisher, exact version, compatibility, nodes, documentation, capabilities, supported modes and examples. Download into staging, reject path traversal/symlinks outside the package, enforce size limits, verify digests and manifest schemas, then activate atomically. Avoid npm lifecycle scripts; do not execute packages merely to discover their metadata.

Use an allowlisted index plus verified package artifacts for the initial release; npm can serve distribution without becoming the trust decision. Provenance/signatures establish origin and integrity, not that code is safe. Provide rollback and explicit dependency-in-use handling for disable/uninstall. Disabled nodes should block new deployment; stopping existing deployments is a distinct action.

Installation occurs on the shared backend, so local web and desktop see the same registry. Browser renderers receive metadata only. A future remotely hosted web version needs server/workspace tenancy and server-side installation permissions; browser-local npm installation is not the design.

A palette, search and inspectable node properties can follow this registry. Editing a flow should create a new draft revision through the same validation path as chat. Canvas changes alone do not enable extension execution.

## Delivery order and acceptance

1. Extract SDK/manifest contracts; inject registry snapshots; route built-ins through the package contract without behavior changes. Existing replay fixtures remain identical.
2. Ship one installable declarative funding-filter package, restricted Kumo form renderer and local package manager. Install adds it to the palette, AI discovery and validator without changing core source.
3. Add pinned dependencies, update/rollback and conflict handling; verify old revisions replay after installing a newer package, failed installation leaves the old registry intact, and missing packages fail closed.
4. Add a public publishing CLI/template and discovery index. Automated package tests cover schema, help/examples, cancellation, permission denial and deterministic replay.
5. Introduce executable community nodes only after isolation and capability enforcement pass dedicated tests. Pilot with a read-only indicator before enabling effectful extensions.

The first milestone is successful when a developer outside the app can publish a package, a user can install it from the UI, Pi can use its declared schema, and the resulting strategy can be replayed with the exact installed artifact. No arbitrary executable package is required to prove this first milestone.
