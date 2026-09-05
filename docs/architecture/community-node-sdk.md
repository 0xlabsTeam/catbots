# Community Node SDK v1

The first implementation installs **declarative subflow packages**, shared by the local web and desktop backend. It does not execute third-party JavaScript or install npm dependencies. Public discovery, signed publisher verification and sandboxed executable nodes remain future work. The SDK is a workspace package; it has not been published to npm.

## Create and install

```sh
node scripts/create-node-package.mjs @acme/funding ./my-funding-node
```

This creates `node-package.catbots.json` without overwriting an existing file. Set your license, edit the definition and share the JSON artifact. In Catbots, open **Nodes**, paste the manifest under **Install a package**, and select **Validate and install**. The built-in Discover example can be inspected before installing.

SDK exports from `@catbots/node-sdk`: `NodePackageSchema`, `validateNodePackage`, `communityConfigSchema`, `CommunityNodeCatalog` and their types. Use `validateNodePackage(JSON.parse(source))` to validate a package during authoring. Schema contracts are in `packages/contracts/src/node-packages.ts`; compiler tests are in `packages/strategy-runtime/src/community-nodes.test.ts`.

## Format

- `format: "catbots-subflow"`, `sdkVersion: 1`, scoped `name`, exact semver `version`, license and exported `nodes`.
- Each node has `kind`, dotted `type`, integer definition `version`, title, description, configurable fields, internal nodes/edges, and exposed input/output mappings.
- Types start with the publisher scope (`@acme/funding` → `acme.funding_filter`). Hyphens in scopes become underscores. Package identity and node type are separate.
- Fields support bounded numbers, strings and booleans with defaults. Catbots renders the controls with Kumo. Templates reference fields using `{ "$param": "threshold" }` in a config value, not code or string interpolation.
- Internals reference existing built-in node types and versions only. Their kinds must match the exported node kind, so a condition cannot conceal an action or a scheduler. No nested community packages or arbitrary dependency resolution in v1.
- Inputs map an external port to one or more internal input ports. Outputs map to one internal output port. Ports must exist and have matching types. Internal cycles are rejected.
- Config/graph bounds and final built-in validation apply. Package validation establishes structural compatibility, not profitable trading behavior or a verified publisher identity.

## Usage and persistence

Installed definitions appear in `list_nodes` and the agent's `validate_strategy` input schema. Configure a node on the Nodes page and copy its instruction to chat. Configuration there prepares the instruction; it does not modify an existing strategy or package.

The agent can include the community type in its candidate graph. Before validation/save, the compiler expands each instance into built-in nodes, rewires the exposed ports, substitutes checked config values and prefixes internal IDs with the parent instance ID. A completed revision stores the expanded graph plus `packageLock` entries (name, package version and SHA-256 digest) inside its canonical document hash.

Execution, backtest and graph inspection use this frozen expanded graph. The canvas currently displays the expanded built-in nodes, not a collapsible macro. Historical replay does not need to execute or re-fetch package code. Existing runtime version/data requirements still apply; package pinning does not replace recorded market inputs.

The backend archives manifests in `node-packages.json`, checks their canonical digest on load, and writes state atomically. One version of a package is enabled for new drafts at a time. Installing another version archives the old one. Enable an archived version to roll back. A reused package name/version with different contents is rejected. Disable removes the types from new agent catalogs but does not alter saved revisions or stop running deployments. Archived artifacts are retained, not deleted.

Limits: 200,000-character import; 64 archived packages per profile; 16 exported nodes/package; 32 internal nodes/export; 20 config fields/export; 1,000 nodes and 3,000 edges after expansion. The installer accepts JSON only, so no archive extraction, filesystem entry points or installation scripts are involved.

## Acceptance evidence

Tests cover expansion into a valid built-in graph, parameter substitution, pinned metadata, disabled-package historical validation, unknown ports, rejected executable fields/nested packages, conflicting definitions, immutable package versions, update/rollback, restart persistence, AI discovery/save and Kumo field rendering. Existing strategy-runtime regression tests are also run.
