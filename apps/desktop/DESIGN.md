# Catbots design system

Catbots extends Cloudflare Kumo. Kumo owns accessible controls, dialogs, tabs, tables and status badges. Product CSS owns layout and references semantic tokens. Do not introduce a second control library or a page-specific theme.

## Source of truth

- `src/renderer/design-system/tokens.css`: palette, typography, spacing, radius, motion, layers and Kumo aliases.
- `src/renderer/design-system/foundations.css`: inherited defaults, including controls rendered in portals.
- `src/renderer/components/BrandLogo.tsx`: brand artwork and supported sizes.
- `src/renderer/app.css`: layouts and component selectors. It must not declare palette or typography values.

Import order is Kumo standalone, tokens, foundations, then application layout. Both Electron and the web preview import the same app.css. System light/dark appearance is honored via semantic light-dark colors. Both renderer entry points call syncSystemAppearance before mounting React so Kumo controls and portals receive the same data-mode. Keep Kumo semantic success, warning, danger and disabled states; orange is for intent, never a substitute for status.

## Logo

Use BrandLogo, backed by the existing `assets/icon.png` app artwork. `icon-source.png` is the source image; `icon.icns` is packaging output. The older simplified SVG and generic Phosphor cat/robot icons are not the brand mark. Do not trace, tint, crop, stretch, filter or replace the artwork. Use small (32 px) in navigation and large (56 px) for onboarding and empty states. Set decorative when adjacent text already names Catbots; otherwise the image announces “Catbots”. A neutral backing surface in dark mode preserves the dark silhouette without modifying the image. Functional bot navigation may still use RobotIcon.

## Typography

One system sans family. Values below are at the default 16 px root; rem preserves user scaling. Never set a smaller root font size.

| Role | Token | Size | Usage |
| --- | --- | --- | --- |
| Caption | --cb-text-caption | 12 px | Timestamp, metadata, table heading |
| Label | --cb-text-label | 13 px | Navigation, compact table cells |
| Body | --cb-text-body | 14 px | Paragraphs, chat, inputs and buttons |
| Subheading | --cb-text-subheading | 16 px | Small section titles |
| Section | --cb-text-section | 18 px | Panel and dialog titles |
| Title | --cb-text-title | 24 px | Major section heading |
| Page | --cb-text-page | 28 px | Page title |

Use regular 400, medium 500 and semibold 600. Body line height is 1.5; headings use 1.25. No text below 12 px, arbitrary text utilities, inline font styles or responsive heading shrinkage. Kumo text-xs/sm/base/lg/xl aliases map to the same scale. Numerical metrics use tabular-nums.

## Layout and interaction

Use --cb-space-* for component spacing (4 px base), and --cb-radius-sm/md/lg for control, panel and container corners. Structural canvas sizes and responsive widths can remain explicit; they are not typography tokens. Keep bordered containers meaningful and avoid nested cards. Tables scroll within their own wrapper on narrow screens.

Use Kumo Button variants: primary for the main action, secondary for alternatives, ghost for navigation. Preserve Kumo disabled, loading and focus behavior. Custom controls require a visible focus ring, a text label or accessible name, and an explicit empty/error state. Keep destructive/live confirmations in their existing workflows. Decorative images use empty alt text. Motion must honor prefers-reduced-motion.

## Preventing drift

Run `pnpm check:design` before review. Root `pnpm typecheck` also runs it. The check scans renderer CSS/TSX for hardcoded palette and typography, arbitrary text utilities, undefined Catbots tokens, local token declarations and direct brand substitutions. Structural spacing and component semantics still need visual review; this is a source guard, not a full accessibility audit.

For a new visual value: first reuse a token. If a new role is necessary, add it once to tokens.css, document its purpose here, and update every affected component together. Never append a screen-specific font or color workaround. Validate the changed screens, a Kumo dialog, narrow viewport and system appearance. Keep functional tests for changed behavior.

## Workbench pattern

Keep Chat mounted when hidden so drafts survive. Inspector opens on node selection; technical metadata belongs in a disclosure. The graph starts at 100% at the entry side, with explicit Fit all for overview. Layer graph nodes by dependency depth so combine nodes follow their inputs. Do not auto-fit long graphs into unreadable text. The graph uses system appearance, including zoom controls and minimap. Keep Stop available for durable deployments even when runtime state is unavailable; explain why and disable Pause without runtime.

Workbench chrome has four regions: compact bot header, tabs with panel toggles, flexible canvas/chat area, and a persistent execution footer. Do not put execution cards or repeated workspace headings above the graph. Market scope and zoom controls share one strip. On desktop only panel contents scroll; the composer and execution controls stay reachable. On narrow screens panels stack and the page scrolls.

### Chat

Chat uses a continuous transcript with right-aligned user bubbles and unboxed assistant Markdown, following the Cloudflare OS chat pattern. Body copy uses `--cb-text-body` and relaxed leading; composer, bubbles, and controls use shared radius/color tokens. `workbench/chat.css` owns chat-specific styles. Keep the real Catbots artwork in the header.

The unified composer supports Enter to send, Shift+Enter for a newline, and IME composition. Suggestions fill the composer without submitting. Users can prepare another draft during a request; completing the request must not erase that draft. Auto-scroll follows new messages only while near the bottom; otherwise expose a latest-message button. Tool activity is visible while a request runs, with reduced-motion support. Markdown does not render raw HTML or remote images. Do not add attachment, model-selection, or stop controls until their backend actions are available.

### Kumo-only control policy

All interactive controls must use `@cloudflare/kumo`: Button, Input, Textarea, Select, Tabs, Link, Collapsible and Dialog. Do not create native HTML replacements or custom control appearance/focus rules. Use Kumo size/variant props; project CSS is for layout and shared content tokens. `pnpm check:design` rejects native controls in renderer TSX. Keep accessible names on icon-only controls. Select item metadata must supply human-readable labels rather than expose stored identifiers.

In a bot workspace, the bot header replaces the global breadcrumb bar. Workspace tabs belong above the artifact pane; chat has its own aligned header. Inspector is only visible for Flow, and switching other tabs preserves chat and draft state.

### Agent interaction states

The real web and desktop transports expose request-scoped Stop. The service rejects overlapping turns for the same bot; Stop aborts only the matching request and preserves completed changes. Synchronous backtests can finish before the event loop handles Stop. The composer remains editable while a request runs, and uses per-bot local draft storage. The activity disclosure contains up to 40 events from the current mounted session; it is not a durable execution audit. Result actions navigate to persisted strategy/backtest data. Review & retry restores the failed prompt for review and never automatically replays tools. Approval remains revision-specific in the existing confirmation dialog, separate from starting Paper/Live.
