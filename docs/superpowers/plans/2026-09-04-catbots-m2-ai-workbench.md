# Catbots M2 AI Bot Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-coding trader open a Draft Bot, describe a strategy in Chat, receive a validated immutable Strategy revision, run a deterministic Backtest through the Agent, inspect its read-only graph/results/traces, and explicitly approve the revision without viewing JSON.

**Architecture:** The sandboxed React renderer consumes typed workbench DTOs through the preload bridge and never receives LLM credentials or raw filesystem access. Electron Main owns compatible-provider calls, a bounded allowlisted Agent tool loop, revision/chat/backtest persistence, and a Backtest service that invokes `@catbots/strategy-runtime`; React Flow only visualizes canonical graph connectivity. M2 uses an explicitly labeled bundled point-in-time sample dataset so the end-to-end Backtest workflow is functional before the external Data Catalog arrives in M4.

**Tech Stack:** TypeScript 5.9, Electron 40, React 19, Cloudflare Kumo 2.13, `@xyflow/react`, Zod 4, better-sqlite3, Vitest 4, Testing Library, Playwright, and the existing `@catbots/strategy-runtime` package.

**Spec:** `docs/superpowers/specs/2026-09-03-tca-perp-bot-design.md` sections 1, 8, 9, 11–13, 16, and 20; `docs/superpowers/specs/2026-09-03-catbots-desktop-ui-design.md` sections 3–4, 7–10, 13–14, 17–21; `docs/superpowers/plans/2026-09-03-catbots-delivery-roadmap.md` M2.

## Global Constraints

- Conversation is the only Strategy editor. Canonical JSON is neither displayed nor directly editable in the M2 renderer.
- Every model-produced Strategy must parse and pass the M1 Registry/graph validator before persistence as a revision.
- The Agent may invoke only `list_nodes`, `list_data_products`, `validate_strategy`, `backtest_strategy`, `explain_strategy`, and `compare_versions` in M2.
- Agent tool execution is bounded to eight tool rounds per user message and rejects unknown tools or malformed arguments.
- The Agent cannot approve a revision, create a Live deployment, raise risk limits, read local secrets, or execute arbitrary code.
- OpenAI-compatible requests use only bearer authentication; Anthropic-compatible requests use only `x-api-key` plus the required API version header. Redirects never forward credentials across origins.
- Complete API keys, authorization headers, raw provider errors, Strategy-incompatible model output, and unrelated account data never reach renderer DTOs, logs, diagnostics, chat persistence, or model prompts.
- Each accepted structural change creates a new immutable integer Strategy version; approval records the exact version and never mutates its document.
- Backtest invokes the M1 validator/runtime and stores a manifest plus summarized results. M2 sample-data runs are visibly labeled `Bundled sample data` and are not presented as investment promises.
- React Flow uses `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}`, deterministic left-to-right layout, Controls, Background, MiniMap, keyboard focus, and accessible node names.
- Layout positions are renderer presentation state and never enter Strategy JSON.
- Use Kumo components and Kumo tokens for application primitives and styling. Product-specific graph/chart/trace CSS may use only semantic Kumo variables.
- M2 does not enable Paper, Live, Hyperliquid execution, Risk Engine deployment, external Data Marketplace providers, arbitrary webhooks, or drag-and-drop graph editing.
- Use test-driven development and commit each independently reviewable task.

---

## Planned File Structure

```text
packages/contracts/src/
├── workbench.ts
├── workbench.test.ts
├── ipc.ts
└── index.ts

apps/desktop/src/main/
├── storage/migrations.ts
├── workbench/workbench-repository.ts
├── workbench/workbench-service.ts
├── workbench/sample-backtest-data.ts
├── llm/compatible-chat-provider.ts
├── llm/openai-compatible-chat.ts
├── llm/anthropic-compatible-chat.ts
├── agent/agent-tools.ts
├── agent/agent-loop.ts
└── ipc/register-ipc.ts

apps/desktop/src/renderer/
├── App.tsx
├── app.css
├── web-preview-api.ts
├── workbench/graph-model.ts
├── workbench/StrategyGraph.tsx
├── workbench/WorkbenchHeader.tsx
├── workbench/ChatPanel.tsx
├── workbench/InspectorPanel.tsx
├── workbench/BacktestPanel.tsx
├── workbench/TraceTimeline.tsx
└── screens/BotWorkbenchScreen.tsx
```

Responsibility boundaries:

- `packages/contracts/workbench.ts` defines sanitized renderer/Main DTOs and strict request schemas only.
- `workbench-repository.ts` owns SQLite queries and transaction boundaries for immutable revisions, approval, chat, and Backtest summaries.
- Provider files normalize protocol-specific message/tool shapes into one Main-only interface.
- `agent-tools.ts` is the sole mapping from allowlisted tool names to Strategy/Backtest operations.
- `agent-loop.ts` owns bounded orchestration and never persists a Strategy directly; it delegates accepted revisions to `workbench-service.ts`.
- `sample-backtest-data.ts` is a deterministic M2 demonstration source and labels its provenance; it is replaceable by M4 catalog adapters.
- `graph-model.ts` is a pure projection from Strategy DTOs/traces to React Flow nodes/edges and layout.
- Renderer components own presentation and ephemeral tab/selection/draft-input state only.

---

### Task 1: Define sanitized Workbench contracts

**Files:**

- Create: `packages/contracts/src/workbench.ts`
- Create: `packages/contracts/src/workbench.test.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**

- Produces `StrategyRevisionSummary`, `WorkbenchState`, `ChatMessage`, `AgentToolActivity`, `BacktestSummary`, `TraceSummary`, and strict Zod schemas.
- Extends `CatbotsDesktopApi` with `workbench.get`, `workbench.sendMessage`, `workbench.runBacktest`, `workbench.approveRevision`, and `workbench.getTrace`.

- [x] **Step 1: Write failing contract tests**

Test valid DTOs, strict rejection of unknown fields, trimmed/non-empty chat messages, UUID bot IDs, positive Strategy versions, finite metrics, trace status enums, and absence of secret-bearing fields in serialized public DTOs.

- [x] **Step 2: Confirm the missing-module failure**

Run: `pnpm --filter @catbots/contracts test -- workbench.test.ts`

Expected: FAIL because `workbench.ts` does not exist.

- [x] **Step 3: Implement strict schemas and typed API methods**

Use DTO projections rather than exporting M1 runtime classes or Maps. A revision exposes node envelopes and edges for visualization but no JSON source string. Backtest summaries expose metrics, equity points, trades, warnings, assumptions label, and trace summaries.

- [x] **Step 4: Verify**

Run: `pnpm --filter @catbots/contracts test -- workbench.test.ts`

Expected: PASS.

Run: `pnpm --filter @catbots/contracts typecheck`

Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: define AI workbench contracts"
```

---

### Task 2: Persist immutable revisions, chat, approval, and Backtest summaries

**Files:**

- Modify: `apps/desktop/src/main/storage/migrations.ts`
- Create: `apps/desktop/src/main/workbench/workbench-repository.ts`
- Create: `apps/desktop/tests/workbench-repository.test.ts`

**Interfaces:**

- Produces `WorkbenchRepository.getState(botId)`, `appendChatMessage`, `createValidatedRevision`, `approveRevision`, `createBacktestRun`, and `getTraceArtifact`.
- Consumes canonical serialized Strategy documents and sanitized DTOs from Task 1.

- [ ] **Step 1: Write failing migration/repository tests**

Create an in-memory database and assert migration v2 adds `strategy_revisions`, `chat_messages`, `backtest_runs`, and `backtest_traces`. Assert version allocation is atomic, documents are immutable, approval targets one existing valid revision, chats preserve order, Backtest summaries round-trip, foreign bot IDs fail, and duplicate artifact hashes do not duplicate trace bytes.

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/desktop test -- workbench-repository.test.ts`

Expected: FAIL because the repository is unavailable.

- [ ] **Step 3: Implement migration v2 and repository transactions**

Store canonical Strategy JSON only in Main-owned SQLite rows. Store Backtest artifact text by integrity hash and reference it from runs. Parse every database row through Task 1/M1 schemas on read; database corruption returns a repository error rather than unsafe partial data.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @catbots/desktop test -- workbench-repository.test.ts database.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/storage/migrations.ts apps/desktop/src/main/workbench apps/desktop/tests/workbench-repository.test.ts
git commit -m "feat: persist immutable strategy workbench state"
```

---

### Task 3: Normalize OpenAI-compatible and Anthropic-compatible chat providers

**Files:**

- Create: `apps/desktop/src/main/llm/compatible-chat-provider.ts`
- Create: `apps/desktop/src/main/llm/openai-compatible-chat.ts`
- Create: `apps/desktop/src/main/llm/anthropic-compatible-chat.ts`
- Create: `apps/desktop/tests/compatible-chat-provider.test.ts`

**Interfaces:**

```ts
interface CompatibleChatProvider {
  complete(request: AgentCompletionRequest, signal: AbortSignal): Promise<AgentCompletion>;
}
```

- `AgentCompletion` contains normalized assistant text and validated tool calls `{ id, name, arguments }`.
- Consumes resolved Main-only `LocalConfig['llm']`; produces no credential-bearing DTO.

- [ ] **Step 1: Write failing protocol tests against loopback servers**

Assert OpenAI `/chat/completions` and Anthropic `/messages` request/response normalization, tool schema mapping, multiple tool calls, timeout, maximum response size, malformed JSON, protocol errors, same-origin redirects, origin-changing redirect rejection, and fixed sanitized error codes. Inspect received headers to prove credentials use only the required protocol headers.

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/desktop test -- compatible-chat-provider.test.ts`

Expected: FAIL because provider adapters are unavailable.

- [ ] **Step 3: Implement a shared bounded HTTP transport and both adapters**

Reuse URL policy from M0. Limit response bodies to 1 MiB, requests to 60 seconds, redirects to three same-origin hops, and model/tool content to JSON-compatible normalized values. Map all remote failures to fixed local codes and discard raw response bodies after parsing.

- [ ] **Step 4: Verify**

Run the focused test outside the sandbox because loopback listeners require it:

`pnpm --filter @catbots/desktop test -- compatible-chat-provider.test.ts`

Expected: PASS with no provider payload or credential printed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/llm apps/desktop/tests/compatible-chat-provider.test.ts
git commit -m "feat: add compatible Agent chat providers"
```

---

### Task 4: Build the allowlisted Agent tool loop

**Files:**

- Create: `apps/desktop/src/main/agent/agent-tools.ts`
- Create: `apps/desktop/src/main/agent/agent-loop.ts`
- Create: `apps/desktop/src/main/workbench/sample-backtest-data.ts`
- Create: `apps/desktop/tests/agent-tools.test.ts`
- Create: `apps/desktop/tests/agent-loop.test.ts`

**Interfaces:**

- Produces `createAgentToolCatalog(dependencies)` and `runAgentTurn(request, dependencies)`.
- Tools: `list_nodes`, `list_data_products`, `validate_strategy`, `backtest_strategy`, `explain_strategy`, `compare_versions`.
- `backtest_strategy` consumes a validated draft and the deterministic sample source, then calls M1 `runBacktest`.

- [ ] **Step 1: Write failing tool-catalog tests**

Assert exact tool names and strict argument schemas. Prove unknown nodes, invalid graphs, malformed Backtest assumptions, and unavailable data return structured tool errors; valid Backtests return sanitized metrics/traces and the `Bundled sample data` provenance label.

- [ ] **Step 2: Implement the six tools with injected repositories/data source**

`validate_strategy` returns stable M1 validation errors. `backtest_strategy` refuses unvalidated documents and persists only completed/cancelled summaries. `explain_strategy` and `compare_versions` are deterministic local summaries assembled from registry metadata and stable node IDs; they do not call another model.

- [ ] **Step 3: Write failing bounded-loop tests**

Use an in-memory fake provider to test plain replies, tool-call/result continuation, invalid tool arguments, unknown tool rejection, eight-round limit, abort, no automatic approval, and persistence only after a structurally valid Strategy is accepted.

- [ ] **Step 4: Implement the Agent loop**

The system prompt includes product boundaries, registered node/data catalogs, current sanitized bot/revision context, and tool schemas. It excludes config objects, credentials, complete traces unless explicitly selected, and any ability to execute generated code.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @catbots/desktop test -- agent-tools.test.ts agent-loop.test.ts`

Expected: PASS.

```bash
git add apps/desktop/src/main/agent apps/desktop/src/main/workbench/sample-backtest-data.ts apps/desktop/tests/agent-*.test.ts
git commit -m "feat: constrain the strategy Agent tool loop"
```

---

### Task 5: Expose the Workbench through validated IPC

**Files:**

- Create: `apps/desktop/src/main/workbench/workbench-service.ts`
- Modify: `apps/desktop/src/main/ipc/register-ipc.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/tests/ipc-security.test.ts`
- Create: `apps/desktop/tests/workbench-service.test.ts`

**Interfaces:**

- Implements Task 1 API methods through channels `workbench:get`, `workbench:send-message`, `workbench:run-backtest`, `workbench:approve-revision`, and `workbench:get-trace`.
- Publishes sanitized `workbench:activity` events for Agent/tool/Backtest progress.

- [ ] **Step 1: Write failing service and IPC tests**

Assert sender validation, strict request parsing, repository ownership checks, fixed error codes, abort/cancellation, activity-event schema validation, no generic IPC primitive, and no config/credential field in responses.

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/desktop test -- workbench-service.test.ts ipc-security.test.ts`

Expected: FAIL because the Workbench service/API is unavailable.

- [ ] **Step 3: Implement Main composition, handlers, and frozen preload methods**

Resolve the current LLM config inside Main for each Agent turn. Do not cache API keys in renderer-facing objects. Replace active request controllers per bot and expose only typed request methods plus a validated activity subscription.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @catbots/desktop test -- workbench-service.test.ts ipc-security.test.ts`

Expected: PASS.

```bash
git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/tests
git commit -m "feat: expose the AI workbench securely"
```

---

### Task 6: Project canonical Strategy graphs into read-only React Flow

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/renderer/workbench/graph-model.ts`
- Create: `apps/desktop/src/renderer/workbench/StrategyGraph.tsx`
- Create: `apps/desktop/src/renderer/workbench/StrategyNodeCard.tsx`
- Create: `apps/desktop/tests/graph-model.test.ts`
- Create: `apps/desktop/tests/strategy-graph.test.tsx`

**Interfaces:**

- Produces `toReactFlowGraph(revision, trace?)` with deterministic three-column positions and semantic edge states.
- Produces `<StrategyGraph revision trace onSelectNode />`.

- [ ] **Step 1: Install React Flow and write failing graph-projection tests**

Run: `pnpm --filter @catbots/desktop add @xyflow/react`

Test stable Trigger/Condition/Action columns, nested-condition vertical ordering, active/false/unknown/rejected/failed edge states, accessible node names, and unchanged canonical revision objects after projection.

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/desktop test -- graph-model.test.ts strategy-graph.test.tsx`

Expected: FAIL because graph components are unavailable.

- [ ] **Step 3: Implement projection and custom nodes**

Use registry-provided title/summary metadata carried in renderer DTOs. Configure React Flow with non-draggable/non-connectable nodes, selectable elements, fit view, Controls, Background, MiniMap, keyboard focus, and no change handler that can mutate canonical semantics.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @catbots/desktop test -- graph-model.test.ts strategy-graph.test.tsx`

Expected: PASS.

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/renderer/workbench apps/desktop/tests/graph-model.test.ts apps/desktop/tests/strategy-graph.test.tsx
git commit -m "feat: visualize strategies with read-only React Flow"
```

---

### Task 7: Build the Kumo Workbench shell, Chat, and Inspector

**Files:**

- Create: `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- Create: `apps/desktop/src/renderer/workbench/WorkbenchHeader.tsx`
- Create: `apps/desktop/src/renderer/workbench/ChatPanel.tsx`
- Create: `apps/desktop/src/renderer/workbench/InspectorPanel.tsx`
- Create: `apps/desktop/src/renderer/workbench/TraceTimeline.tsx`
- Modify: `apps/desktop/src/renderer/screens/BotsHomeScreen.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Create: `apps/desktop/tests/bot-workbench.test.tsx`

**Interfaces:**

- Bots Home opens a selected bot by stable ID.
- Workbench center tabs are Graph, Backtest, Performance, and Logs; right rail tabs are AI Chat and Inspector.
- Node/trace selection is renderer state and never changes Strategy JSON.

- [ ] **Step 1: Write failing interaction tests**

Cover loading/error/empty revision states, opening a Bot, sending a message, preserving the Chat draft and scroll, activity progress, selecting a node, idle versus busy Inspector switching, immutable revision badges, approval confirmation, disabled Paper/Live controls, keyboard tab order, and narrow-width right drawer behavior.

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/desktop test -- bot-workbench.test.tsx bots-home.test.tsx`

Expected: FAIL because the Workbench screen is unavailable.

- [ ] **Step 3: Implement with Kumo defaults**

Use Kumo `Button`, `Badge`, `Tabs`, `Textarea`, `LayerCard`, `Banner`, `Dialog`, `Table`, `Loader`, and `Tooltip`. Keep the full three-pane layout at 1180 CSS pixels or wider; below that width the right rail becomes a drawer. Use plain-language copy and always pair status color with text/icon.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @catbots/desktop test -- bot-workbench.test.tsx bots-home.test.tsx renderer-theme.test.ts`

Expected: PASS.

```bash
git add apps/desktop/src/renderer apps/desktop/tests
git commit -m "feat: add conversational bot workbench"
```

---

### Task 8: Add Backtest results, assumptions, chart, trades, and trace inspection

**Files:**

- Create: `apps/desktop/src/renderer/workbench/BacktestPanel.tsx`
- Create: `apps/desktop/src/renderer/workbench/EquityCurve.tsx`
- Modify: `apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Create: `apps/desktop/tests/backtest-panel.test.tsx`

**Interfaces:**

- `<BacktestPanel summary onRun onSelectTrace />` renders M1 metrics and sample-data provenance.
- `<EquityCurve points benchmark?>` exposes an SVG chart plus an accessible metric/table alternative.

- [ ] **Step 1: Write failing Backtest UX tests**

Cover no-run, running, cancelling, completed, failed, and stale/sparse warning states; metric formatting; sample-data disclosure; pinned assumptions; equity curve accessible summary; trades linked to traces; and language separating observed results from suggestions.

- [ ] **Step 2: Confirm failure**

Run: `pnpm --filter @catbots/desktop test -- backtest-panel.test.tsx`

Expected: FAIL because Backtest components are unavailable.

- [ ] **Step 3: Implement the Kumo Backtest panel and trace links**

Render return, drawdown, Sharpe-like metric, win rate, trade count, fees, and funding with tabular numerals. The run form controls date range, starting capital, fee, and slippage assumptions; submit through the typed API and never imply future performance.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @catbots/desktop test -- backtest-panel.test.tsx bot-workbench.test.tsx`

Expected: PASS.

```bash
git add apps/desktop/src/renderer/workbench apps/desktop/src/renderer/screens/BotWorkbenchScreen.tsx apps/desktop/src/renderer/app.css apps/desktop/tests
git commit -m "feat: present inspectable Backtest results"
```

---

### Task 9: Make Web Preview exercise the complete M2 workflow

**Files:**

- Modify: `apps/desktop/src/renderer/web-preview-api.ts`
- Modify: `apps/desktop/tests/web-preview-api.test.ts`
- Modify: `e2e/desktop-smoke.spec.ts`
- Modify: `README.md`

**Interfaces:**

- Web Preview returns deterministic in-memory Workbench state and simulates one Agent-authored revision plus Backtest without reading YAML, SQLite, credentials, or network.

- [ ] **Step 1: Write failing preview and desktop smoke tests**

Assert create/open Bot, send requirement, receive validated revision, render read-only graph, run Backtest, inspect a trace, approve exact revision, reload desktop persistence, and verify Paper/Live remain disabled. Assert preview data stays memory-only and resets on reload.

- [ ] **Step 2: Implement the preview adapter and README workflow**

Use the public `CatbotsDesktopApi`; do not add preview branches inside Workbench components. README documents `pnpm dev:web`, the deterministic simulated Agent, bundled sample-data limitation, and Electron requirement for real provider/SQLite verification.

- [ ] **Step 3: Run milestone verification**

Run: `pnpm typecheck`

Expected: exit 0.

Run outside the sandbox: `pnpm test`

Expected: all workspace tests pass.

Run: `pnpm test:e2e`

Expected: Electron smoke tests pass on Node.js 22.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/web-preview-api.ts apps/desktop/tests/web-preview-api.test.ts e2e/desktop-smoke.spec.ts README.md
git commit -m "test: prove the M2 AI workbench workflow"
```

---

## Completion Gate

- [ ] A configured compatible provider can complete a bounded Agent turn using only the six allowlisted tools.
- [ ] A model cannot persist an invalid graph, approve a revision, access credentials, execute arbitrary code, or invoke an unknown tool.
- [ ] Every accepted structural change is an immutable incremented Strategy revision.
- [ ] The same M1 validator and Backtest runtime power Agent tools and visible Backtest results.
- [ ] React Flow is read-only, deterministic, accessible, selectable, and visually distinguishes true/false/unknown/rejected/failed paths.
- [ ] Chat, Inspector, Backtest assumptions, metrics, trades, and trace details survive local desktop restart.
- [ ] Web Preview exercises the complete workflow with a clearly labeled simulated Agent and bundled sample data.
- [ ] Renderer/Main IPC remains narrow, validated, frozen, and free of generic primitives or secret-bearing DTOs.
- [ ] Paper and Live controls remain disabled until M3.
- [ ] Typecheck, all unit/integration tests, Electron smoke tests, placeholder scan, secret-field scan, and `git diff --check` pass on Node.js 22.
