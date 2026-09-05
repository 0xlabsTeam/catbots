# Cloudflare OS → Catbots: UX review

Reviewed 2026-09-06 from the official public demonstration at https://os.cloudflare.app/ and the Cloudflare OS frontend source. The public page is a product demonstration, not an authenticated interactive workspace. Runtime behavior below was checked against the source; no claim of testing a logged-in Cloudflare OS account.

## Navigation and use of space

| Area | Cloudflare OS evidence | Catbots decision |
| --- | --- | --- |
| Global navigation | Sidebar has expanded and collapsed states; source defines a 260px desktop rail and 56px collapsed rail. Utility actions sit in a small bottom strip. | Keep global destinations in the rail. Avoid another global breadcrumb row inside a bot. |
| Workspace context | Compact workspace/chat headers; chat subheader is omitted when the conversation list already provides context. | One bot header with name, version and approval. Remove the repeated Workspace/Bots bar in this view. |
| Artifact tabs | Build demonstration shows App/Code/Connections attached to the artifact pane, not above the conversation. | Flow/Backtest/Performance/Logs belong to the right pane. Chat stays visible and does not change when an artifact tab changes. |
| Split panes | Source has pointer-driven sidebar resizing and constrained transcript widths. | Keep independent scrolling. Current Catbots split remains responsive but not user-resizable; adding resizing is a separate remaining improvement, using a supported Kumo primitive. |
| Inspector | Reference surfaces context/actions alongside the relevant work. | Show node inspection only on Flow; do not subtract width from backtest tables or logs. |
| Empty space | Chat source constrains wide transcripts to a maximum readable width and pins the composer. | Use space for reading and editing, not repeated labels. Empty artifact pane explains the next action. |

## Chat interaction

- User messages are compact right-aligned bubbles; assistant text is unboxed and readable. Markdown paragraphs, headings, lists and code have consistent spacing.
- Source composer has a persistent bottom input area, model selection and conditional stop/send actions. Only wire controls supported by Catbots; do not imitate unavailable attachment/model/stop actions.
- Source supports activity/tool groups and streaming output. Catbots now provides expandable session activity history, request-scoped Stop, and real provider text streaming through Pi. Final responses replace transient text after persistence.
- Catbots supports Enter to send, Shift+Enter for a newline, IME-safe input, copying, preparing the next draft while a request runs, and a latest-message affordance when reading older history.
- GFM tables in both partial and saved replies render with Kumo Table inside a horizontally scrollable container. Raw HTML and remote images remain disabled.

## Kumo-only implementation rule

Use Kumo components for interactive UI, including search/filter, composer, copy buttons, disclosure controls and navigation buttons. Do not recreate native buttons, inputs, selects or disclosure widgets. Layout and content spacing use the shared tokens. Renderer source validation now rejects native interactive replacements.

## Verification

- Chat, workbench and Bots: 33 tests passed after migrating controls to Kumo.
- TypeScript and design-token/control guard checked.
- Real local web workspace inspected with a saved conversation and backtest results.
- Cloudflare reference inspected through the official Build demo and frontend source, especially `ChatInterface.tsx`, `features/chat/composer/ChatComposer.tsx`, and `components/AppShell/Sidebar.tsx`.
