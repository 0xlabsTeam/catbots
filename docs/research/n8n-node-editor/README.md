# n8n node editor study and Catbots implementation

Reference cloned on 2026-09-06 using `git clone --depth 1 --filter=blob:none --sparse https://github.com/n8n-io/n8n.git`.
Local research checkout: `/tmp/catbots-n8n-reference`.
Pinned reference commit: `7cb77fbed687be1dd7dcc38a057ec1f42c561c73`.

## Source examined

- `packages/frontend/editor-ui/src/features/ndv/shared/views/NodeDetailsView.vue`: three panel detail view, run indexes, linked input/output runs, panel sizing.
- `packages/frontend/editor-ui/src/features/ndv/panel/components/InputPanel.vue`: input connections, source selection, execution selection.
- `packages/frontend/editor-ui/src/features/ndv/panel/components/OutputPanel.vue`: output results and run data.
- `packages/frontend/editor-ui/src/features/ndv/runData/components/RunDataDisplayModeSelect.vue`: Schema, Table and JSON views.
- `packages/workflow/src/interfaces.ts`: node execution role, connection types, configuration properties and execution items.
- `packages/nodes-base/nodes/If/V2/IfV2.node.ts`: two main output branches named true and false.
- `packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts`: inputless trigger, main output and schedule lifecycle.

Reference: https://github.com/n8n-io/n8n/tree/7cb77fbed687be1dd7dcc38a057ec1f42c561c73

## Implemented in Catbots

- Node selection opens a Kumo Dialog with Input, Parameters and Output panes. Small screens show one pane at a time. Escape/Back to canvas closes it with focus handled by the dialog.
- Packaged chat flows and the sandbox share the same node editor. Legacy strategies use the shared three-pane layout and data viewer while retaining their configuration/save semantics.
- Input/output selectors show declared port types and connected source/destination nodes. Packaged nodes can navigate directly to another node from the connection label or the node selector.
- Data has independent Schema/Table/JSON views. Schema describes observed runtime fields; it is explicitly not a complete inferred contract. Tables page by 20 records; JSON preserves raw values and precision. Missing/unavailable data is distinguished from false, zero and empty collections.
- Parameters and definition settings are separate. Execute step evaluates the selected node and its upstream dependencies against current Hyperliquid data; outputs are order proposals only.
- A bot workspace retains up to 20 recent packaged run records. Both panels use the selected execution. A node absent from that execution shows no result rather than substituting a different run. Changed market/configuration marks historical data stale.
- Node package metadata now includes the Trigger/Action role independently of the trader-facing category. The sandbox can filter either role and still group by Indicator, Risk, etc.

## Compatibility and boundaries

The runtime now also supports native `items` ports carrying `{ json, pairedItem? }[]`. JSON fields retain their actual types; configuration remains separate. If filters and forwards the original items; empty branches skip downstream execution. Merge can append active branches or match a unique scalar key (conflicts and cross-market matches fail). Split Out, Edit Fields (literal JSON or safe field mapping), and Aggregate implement list operations. JSON rejects non-finite values, unsafe property paths and more than 10,000 items; lineage references identify the immediate source output and item index, recursively inspectable through the trace.

Native packaged nodes now cover Market evaluation → Get market candles → RSI/EMA/SMA/ATR Items → If → Edit Fields → Propose orders Items. These use the same real market snapshot, closed-candle calculations, order validation and simulation restrictions as existing nodes. Trading items must match the execution market. Each order proposal gets a deterministic per-run/item identifier. No orders are dispatched by manual execution.

Existing schema 3.0 documents, typed ports, node IDs and configurations remain valid without a destructive migration. Item definitions are additive and available to AI through the existing catalog; the prompt now explains item flow construction. Explicit number/candles/condition/orders adapters connect older typed nodes. The reverse adapter requires exactly one market-matching item, preventing accidental per-candle orders. Stateful DCA/Grid/Risk nodes retain their tested typed semantics and can use these adapters. The sandbox can add a native item example without replacing an existing graph.

This uses n8n as a reference, not copied source or a compatible n8n engine. It does not load n8n packages or support arbitrary JavaScript expressions, binary attachments, cyclic workflows or pinned data. Historical backtesting is now implemented in the [packaged-flow replay](../flow-backtest/README.md). Live execution remains unavailable.

Run history remains workspace-local and is cleared when that bot workspace is left/reloaded. Legacy run data retains its existing revision-local lifetime.

## Verification

Regression coverage includes parameter persistence across selection/close, execution provenance, bounded history, missing-node run behavior, paginated data/JSON fidelity, source navigation, unknown values, sandbox import and legacy approval separation. Real browser checks cover desktop and mobile editor layout, a Hyperliquid EMA run and overflow. Workspace typecheck, design token checks, runtime tests and renderer build are used before completion.

Verified results: node-kit 3 tests and strategy-runtime 153 tests passed; updated renderer regression suites passed after accounting for the new modal navigation. Workspace typecheck and design checks passed; renderer build passed with the existing >500 kB bundle advisory. Browser verification confirmed same-run source navigation, all 200 candle records in JSON, observed schema, mobile pane switching and bounds, Escape close, and the legacy editor with no JavaScript errors.

Screenshots: [Desktop](desktop.png) · [Mobile](mobile.png).

Item-runtime regression: native end-to-end flow, branch isolation, empty-branch Merge, one-to-many lineage, mapping/aggregation, strict comparison, JSON validation, market isolation and adapter cardinality. Strategy-runtime suite: 161 tests passed.

Native item UI verification: 27 renderer regression tests passed. A real Hyperliquid run returned one ETH-PERP item containing 200 closed candles, a numeric RSI and a valid source link; browser checks passed at 1440px and 390px with no page errors. Screenshots: [Item editor](items-desktop.png), [Mobile item output](items-mobile.png). Workspace typecheck/design checks and renderer build passed (existing bundle-size advisory remains).

Try it: Nodes → Open flow editor → Add JSON item example. This adds a separate RSI example to the unsaved sandbox without replacing its graph. Click RSI · Items → Execute step to inspect live input/output. Save draft stores the sandbox in this browser; Import into new bot stores it in the shared backend.

## Visual refinement

Packaged flow nodes now use a compact icon tile with the title, configuration summary and category below it. Trigger tiles have an asymmetric silhouette; all categories retain their shared color/icon identity. Handle positions and Dagre dimensions share `programNodeSize`, including the tile inset. JSON items have solid connectors; typed data retains dashed connectors. Selection and keyboard focus highlight the icon tile. Port names remain available on the tile/tooltips and in the inspector.

The sandbox toolbar and market/import row are compact, and the palette can be toggled on desktop as well as mobile. The editor uses a category icon, human-readable node selector, distinct configuration pane, primary Execute step button and bordered empty/data states. Kumo controls and shared typography, spacing and radius tokens remain in use.

Validation: 20 relevant UI tests, full workspace typecheck/design checks and renderer build passed. Browser checks covered light/dark canvas, node selection, real Hyperliquid item execution and mobile output bounds. No browser errors were observed. Screenshots: [Light canvas](style-light.png), [Dark canvas](style-dark.png), [Node editor](style-editor.png).

Node positioning: packaged chat flows and legacy graphs now support dragging with a five-pixel threshold separating drag from click-to-inspect. Layout is stored in local device/browser storage, scoped by bot (and revision for legacy graphs), independently of strategy configuration, validation and run data. Auto layout clears manual coordinates. The sandbox retains its existing Save draft workflow for positions. Browser verification passed drag, no modal on drag, reload persistence, reset and click-to-inspect; 13 relevant regression tests, desktop typecheck and design-system checks passed.
