# Task 10 implementation report

## Outcome

Completed the remaining Create Bot renderer work on base `a5d46a9b0c44f01a190661484be704c35e7a7ee9` without reverting the `{ name, dex }` compatibility path pulled forward in Task 1.

- The dialog now contains exactly one Bot name input and one real Kumo `Select` labeled `DEX`.
- The Select exposes one option, `Hyperliquid`, keeps the adapter value `hyperliquid`, and submits exactly `{ name, dex: 'hyperliquid' }`.
- The dialog has no Market field and no future-support or coming-soon message.
- Keyboard interaction opens the Select, exposes its single accessible option, and submits the form through Enter.
- The Bot table keeps its `DEX` column and now displays the user-facing value `Hyperliquid` rather than the adapter id.
- The empty state now describes a DEX-scoped strategy workspace.
- No custom CSS was necessary; the installed Kumo component's default styling remains authoritative.

No push, merge, publish, or subagent work was performed.

## RED / GREEN evidence

### RED

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/bots-home.test.tsx
```

Result: exit 1; 3 failures and 14 passes. The regressions failed because the dialog had no accessible DEX combobox, the table rendered `hyperliquid` instead of `Hyperliquid`, and the empty state did not describe a DEX-scoped strategy workspace.

### Focused GREEN

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run tests/bots-home.test.tsx
```

Result: 1 file passed; 17 tests passed.

## Broad verification

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm --filter @catbots/desktop exec vitest run
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm typecheck
git diff --check
```

Results:

- Desktop typecheck passed.
- Full desktop suite passed: 40 files passed, 1 skipped; 332 tests passed, 1 skipped.
- Workspace typecheck passed for contracts, strategy-runtime, execution-core, and desktop.
- Diff check passed before report creation and will be rerun on the final staged patch before commit.

## Changed files

- `apps/desktop/src/renderer/screens/CreateDraftBotDialog.tsx`
- `apps/desktop/src/renderer/screens/BotsHomeScreen.tsx`
- `apps/desktop/tests/bots-home.test.tsx`
- `.superpowers/sdd/2026-09-05-dex-scoped-dynamic-markets/task-10-report.md`

## Compatibility and scope

- Task 1's already-landed public Bot contract and renderer call shape were preserved.
- Task 10 adds only the missing visible Select, accessible behavior, DEX display formatting, scoped empty copy, and regressions.
- `apps/desktop/src/renderer/app.css` was intentionally unchanged because the Kumo Select fits the existing grid and requires no custom styling.

## Concerns

No Task 10 blocker remains. The DEX registry currently contains only `hyperliquid`, so the display-name map is exhaustive for the approved public contract.
