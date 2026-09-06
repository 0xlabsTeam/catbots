# Usability audit follow-up — 2026-09-06

This follow-up addresses all 13 findings in README.md. Original screenshots document the problems, not the current UI.

| # | Resolution |
| --- | --- |
| 1 | Unsaved packaged node configurations now live in the bot workspace, keyed by node. Switching nodes, closing the inspector and changing tabs preserves edits. External configuration changes produce a conflict notice instead of overwriting the local draft. |
| 2 | Run market is shared across the workflow. Switching nodes retains SOL-PERP or any other entered market. |
| 3 | Workspace retains each node’s run record, market, snapshot and document provenance. Results are labelled stale after changes; completion after switching selection is retained. |
| 4 | Legacy manual Interval activation explicitly records `activationSource: manual-run` and runs outside schedule boundaries. Scheduled evaluation retains its time gate. |
| 5 | Workbench opens with collapsed global navigation and a narrower chat pane. Packaged graphs start at readable zoom aligned to the first node, rather than repeatedly fitting every streamed edge. Fit flow, 100% and Focus node are available; legacy initial fit has a readable minimum zoom. |
| 6 | Provider/model controls initialize from the active selection. Compatible API fields are collapsed when the connections section is present, explain when they apply, and are separate from profile/execution settings. |
| 7 | Packaged Backtest tab explicitly says unavailable. Validate flow checks nodes/configuration/connections with the runtime validator and persists validated state through the shared backend. Copy distinguishes synthetic example simulation from real-market manual debug. |
| 8 | Node debug shows outputs before inputs, scalar/object summaries and the latest five array records. Full JSON is available on demand with bounded scrolling. Snapshot/candle times use local display, with UTC available on candle timestamp hover. |
| 9 | Standalone editor is explicitly a browser-local Flow sandbox. Import into new bot validates and atomically saves its document to the shared backend, then opens AI chat. Existing flows cannot be overwritten. A failed import retries against the same created bot. |
| 10 | Data and Activity are marked Soon in navigation and Coming soon in-page. Their empty states point to working per-bot data/debug/log views and provide Open bots. |
| 11 | Tablet navigation uses an icon rail; mobile navigation fits five destinations. Mobile workbench switches Chat / Flow & results, node inspection uses the available pane, and the sandbox palette is collapsible. |
| 12 | New run settings and Selected run results are separated. Saved dates consistently show UTC; users can copy selected assumptions or dataset coverage into the new run form. Responsive form/results avoid page overflow. |
| 13 | Transport failures show Cannot reach local workspace with Retry, instead of claiming database corruption. Actual repair state includes backup-first recovery guidance and Retry. Runtime-unrestored copy directs users to check saved logs without claiming events must exist. |

## Verification

- Regression tests cover retained edits, shared market, stale results, late completion, manual versus scheduled activation, import validation/overwrite protection/retry, active model, transport retry, summary/JSON data, settings and backtest behavior.
- Browser traversal: Bots, Settings, Data, Activity, Nodes, sandbox and bot flow at 1440, 768 and 390 px. No document horizontal overflow or JavaScript errors observed.
- Real Hyperliquid manual run: SOL-PERP run ID/market retained across node and tab switches; legacy Interval activates with a non-scheduled market timestamp. No exchange orders dispatched.
- Workspace typecheck/design-system checks and renderer production build. Build retains existing large-bundle advisory.

## Scope

Manual run state is retained for the open bot workspace, not across application reloads or leaving that bot. Sandbox storage remains browser-local until import. Data/Activity remain forthcoming features; packaged historical backtest and Paper/Live deployment remain unavailable. Validation checks graph correctness, not trading profitability. Native desktop-specific window behavior was not re-audited; renderer and backend paths are shared.
