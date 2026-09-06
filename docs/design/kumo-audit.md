# Kumo component audit — 2026-09-07

UI primitives come from `@cloudflare/kumo`. React Flow is the explicit user-approved exception for the interactive graph canvas, handles, edges, minimap and dragging. Dagre provides layout, not UI. ECharts is injected into Kumo TimeseriesChart as required by Kumo; it is not rendered directly.

## Screen coverage

| Screen / surface | Kumo components |
| --- | --- |
| App navigation | Sidebar, Breadcrumbs |
| Bots and deletion | Button, Input, Select, Table, Empty, LayerCard, Banner, Dialog |
| Connections | Button, Input, Select, Table, LayerCard, Collapsible, Badge, Banner |
| Nodes / packages | Button, Input, Textarea, Switch, Table, LayerCard, Badge, Banner |
| Settings / first launch | Button, Input, Select, Switch, Tooltip, Dialog, LayerCard, Banner |
| Create bot | Dialog, Input, Select, Button, Banner |
| Workbench / chat | Tabs, Textarea, Button, Badge; Markdown tables, links, task checkboxes and code blocks use Kumo |
| Flow / node inspector | LayerCard, Badge, Input, Select, Switch, Tabs, Table, CodeBlock; React Flow canvas |
| Backtest | TimeseriesChart, Collapsible, Table, Input, Select, Switch, Button, LayerCard, Banner |
| Deploy / performance | Button, Select, Input, Badge, LayerCard, Table, Collapsible, Banner |
| Execution logs | Tabs, Select, Input, Collapsible, CodeBlock, Badge |
| Account trading activity | Dialog, Table, Badge, Banner, Button |
| Paper / live review | LayerCard, Input, Select, Button, Badge, Banner |
| Database repair | Button |
| Data / Activity placeholders | Shared app shell; no additional interactive primitives |

Structural HTML, text, app artwork, and layout CSS are not replacement UI primitives. Domain components may compose Kumo components. Do not implement alternative buttons, selects, dialogs, tabs, tables, code viewers or chart renderers.

## Changes

- Replaced homemade sidebar / breadcrumb markup with Kumo Sidebar and Breadcrumbs; removed obsolete sidebar CSS.
- Replaced the custom SVG equity plot with Kumo TimeseriesChart, preserving the accessible data table and actual results.
- Replaced raw JSON views and Markdown code blocks with Kumo CodeBlock.
- Used Kumo Checkbox for Markdown task lists.
- Used Kumo LayerCard for the node icon surface; removed custom card shapes, gradients and badge overrides. Graph geometry and category colors remain part of the canvas presentation.
- Separated the trading activity dialog from the full-screen node editor layout, with padding and scrolling.
- Expanded `pnpm check:design` to reject native table, pre, progress and SVG primitives in renderer TSX, alongside native interactive controls.

## Verification scope

Source audit covers renderer screens and workbench components. Browser checks covered all six navigation destinations, all five workbench tabs, saved backtest chart rendering, the delete dialog (opened and canceled), and mobile navigation at 390px. No trading actions were performed. First launch, database failure and live-review states were checked in source, not triggered against the live profile. The CSS/token check is a guardrail, not proof of complete visual consistency.
