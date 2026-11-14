# Single-selection scope synchronization

This narrow follow-up depends on proposal safety `b0bfeb4` and keeps the upstream `f0c819f` selection policy implementation. It does not add Ctrl/Cmd multi-selection or inline red/green review.

## Behavior

- A local, per-mounted-AI-panel tracker observes document ID and effective selected block ID/type. Changing selection defaults to selection scope; no valid selected block defaults to document scope. A manually chosen whole-document scope only lasts for that selection context.
- Store subscription observes each transition, including A → B → A within a batched React update. Rendering derives the new default immediately, not after a passive effect. Ordinary edits to the same block do not count as a selection change.
- AI edit and opt-in instruction-suggestion requests capture the scope token. Late responses/errors from an obsolete scope or unmounted panel cannot create proposals or replace the current suggestion. A newer request's busy state is not cleared by an older request's completion. Existing suggestion abort/queue/throttle behavior remains; this change does not add edit-request transport cancellation.
- Existing proposal version and document-reference checks remain. Server-owned filter/strict policy, ignored counts, subtree/anchor semantics, replay and HTML handling are unchanged.
- The property panel already derives its block through `selectedBlock`. Tests confirm selection, delete-neighbor fallback, undo/redo and removal of a now-invalid selection use the corresponding module form or article form. No store-global selection state was added or changed. Undo does not invent a prior selection: it retains the existing upstream selection behavior.

## Evidence and remaining gates

New React + real store tests are component integration, not strict isolated-unit coverage. Initial eight cases produced seven genuine failures on the previous implementation; the property-panel case already passed. A separate opt-in suggestion ABA case also failed before the scope guard was extended to that existing request path. Twelve new component cases cover scope reset, ordinary input, batched ABA, no selection, delete/history/document switch, property forms, unmount, two overlapping requests and obsolete errors/suggestions.

Three desktop Playwright scenarios use a synthetic routed provider and real UI interactions. They cover selection/manual scope/deselection, property deletion/history, and a delayed A response after switching to B and back. Cloud discovery is not browser execution; these require actual Windows validation. Phone behavior must be validated in the responsive-shell combination, not claimed from this desktop-base branch.

One new production module (`src/editor/useSelectionScope.ts`) must remain in complete-source coverage. No coverage percentage or strict-unit gate is claimed. A further real-component regression dispatched an old rendered button in the same React batch as a selection change. It failed before checking the rendered scope token at the request entry point, then passed; request dispatch now rejects that pre-render closure instead of pairing old request arguments with a new token. Suggestion dispatch has the same preflight guard.

Final frozen-source checks: full mixed suite 73 files, 763 passed and one existing platform skip (764 total); full ESLint, TypeScript and production build passed. The existing large-chunk build warning remains. All three new browser cases were discovered but not executed. The installed tools were invoked directly through Node with unchanged dependencies/lockfile, as for the preceding proposal-safety gate.

## PR13 dependency follow-up

This candidate includes PR13's configuration follow-up `7dcef657bb4060ba635189438a5414e4116235f6` (local cherry-pick `f4e8a69`). Its parent is exactly `b0bfeb4`; its complete change set is the IPv4 development/ready/browser addresses, failure-trace retention, four configuration contracts and their QA note. No production source changed during that integration. The remote PR13 revision is reported by the coordinator as `13e5a17`; publication must use and verify that remote parent, not assume the local and remote commit IDs are identical.

After integrating the configuration, the full mixed suite passed: 74 files, 767 tests passed, one existing platform skip (768 total). Full ESLint, TypeScript and production build passed (existing chunk-size warning only). Full development E2E discovery lists 50 tests in 18 files, including all three new scope cases. These are **discovered, not executed** here. Fresh Windows browser validation remains pending for this changed scope candidate, regardless of PR13's earlier green CI. This feature suppresses obsolete edit responses but does not claim transport cancellation.

Relative to local PR13 baseline `7dcef657`, the contribution is exactly five files: this QA note, `src/editor/RightPanel.tsx`, `src/editor/useSelectionScope.ts`, `tests/e2e/selection-scope-sync.spec.ts` and `tests/unit/selectionSyncPanel.test.ts`.
