# Multi-selection foundation (not yet interactive UI)

> **Provenance note:** This file records the original full-combination implementation and its historical gates. The current narrow port deliberately excludes image handles, responsive/theme shell, typography and CAS additions. Its actual dependencies, exclusions and fresh verification are in `multiselect-narrow-port.md`; historical counts below are not narrow-source results.

Base: `f444608` combined proposal-safety, single-selection scope, save-safety, font and image-resize candidate. This batch implements selection protocol and store foundations only. Canvas, RightPanel, useSelectionScope and proposalSafety are unchanged. Ctrl/Cmd pointer handlers, mixed properties, multi-selection request capture/ABA protection, keyboard deletion and mobile interaction are **not wired or verified by this batch**. Do not advertise complete multi-select from this commit alone.

## Interfaces and boundaries

- Store: `selectedIds: string[]`, `selectedId` remains a member/primary or null. `select(id, {toggle:true})` adds/removes; old `select(id)` remains single selection; null clears. Editing/picking narrows to one target. Selection is not persisted in document history.
- `removeSelected()` commits a multi-delete once, including overlapping ancestor/child selections. A one-item selection delegates to existing `removeBlock`, preserving neighbor selection. Undo/redo preserve document history, clear proposals via the existing version guard, and prune invalid selection references; they do not restore old UI selection sets or stale proposals.
- HTTP edit and suggestion accept optional `selectedIds` while retaining old scalar `selectedId`. Explicit lists must be nonempty unique strings resolving unambiguously. Request/focus lists must name the same set. A supplied primary must be a member; two supplied primary identities must agree. Legacy `focus.id` without `focus.ids` remains a single boundary and cannot be widened by a multi-item list. Invalid selection never falls back to whole-document mode. Only absent selection means whole-document mode.
- Client: `api.aiEdit(context,instruction,profileId,selectedId,selectedIds)`; `api.aiSuggestInstruction(context,profileId,selectedId,signal,selectedIds)`. Existing positional callers and suggestion AbortSignal stay compatible. This is **not** new edit-network cancellation.
- Server helpers: `resolveEditSelection(context, selectedId?, selectedIds?)`; `prepareEdit(context, selectedId?, policy?, selectedIds?)`. Policy remains server-owned. `editPrompt`/`scopeEditResult` internally support scalar or list selection.
- Core `selectionScopes` validates each selected subtree and unions its IDs/top roots. Duplicate IDs outside the chosen subtrees do not invalidate unrelated selections, preserving the existing scope rule. A chosen subtree containing ambiguous identities is rejected.
- Strict remains all-or-nothing, update-only within the subtree union. Filter allows union updates/removals and inserts immediately before/after selected top-level roots; outside edits, move, theme/meta changes are dropped and counted. Child selection still anchors insert at its containing top-level box, not inside an unrelated sibling. Existing children-replacement/replay validation and proposal journal are untouched.
- Shared insertion gaps default to the first valid top root in document order, independent of click order. Explicit valid alternative anchors are retained; contradictory anchors are rejected. Numeric string indices remain compatible. Existing orderInsert and stale/anchor behavior are retained.
- `aiContext` uses full selected top roots and summary-only neighbors with original document indices. Empty scalar/list or ambiguous/missing selections are rejected before serialization. It does not silently renumber a filtered document.

## Production state-write audit

All selection writes in production `src` are centralized in store initialization/load/select/validSelection. There are no production `useStore.setState({selectedId:...})` callers; remaining store.setState calls update save status/revision only.

- load/documentNavigation/import/restore reset both selection fields.
- insertBlock, duplicateBlock and replaceBlock call select; insertBlocks retains the prior selection as before, through commit validation.
- setEditing/setPicking narrow through select. commit validates references after properties, direct document edits, photo swapping and image-resize operations.
- moveBlock/moveBlockTo preserve valid selected identities through commit, including movement into/out of a box.
- App drop paths use insertBlock, move actions or commit followed by select. Canvas photo swapping and ImageResize use commit; no bypass assignment was found.
- undo/redo validate against the restored document and retain the existing proposalVersion invalidation. CAS/save generation code is unchanged.
- Existing App Delete still invokes removeBlock; multi-delete keyboard integration is a later batch.

The imageResizeDom test fixture directly replaced the complete store with an impossible partial selection (`selectedId` set but new `selectedIds=[]`). Five tests consequently lost selection after a width commit. Its fixture now initializes both fields; all prior keyboard, pointer, DOM identity and undo assertions remain unchanged. Production ImageResize was not modified. Public actions, not arbitrary external setState mutations, define supported state transitions.

## Evidence and classification

Tests are mixed: pure boundary functions, real Zustand document/history integration, actual local HTTP routes with a mocked provider, and existing React/DOM suites. They are **not a strict-unit-only coverage result**. No new production module was added; all modified src/server sources must remain in the full denominator.

- Initial 15 foundation cases: 15 failed on the old source, then passed.
- Five actual HTTP cases: five failed before route wiring, then passed. Tests retain real Express/local HTTP and mock the provider boundary; no real model credentials or calls.
- Additional legacy-focus widening and ambiguous aiContext cases failed before their guards; explicit-empty scalar and single-delete-neighbor cases also failed before correction.
- A new anchored-insert assertion initially used the pre-validation generated ID; it was corrected to inspect the accepted operation's actual ID, preserving the assertion about visible insert position and deleted-anchor rejection. IDs are intentionally regenerated by validation; this was a test identity assumption, not a product anchor regression.
- Final frozen-source checks: 99 mixed test files passed, 1,039 tests passed and two existing platform cases skipped (1,041 total). Full ESLint, TypeScript and Vite build exited 0; build retains the existing large-chunk warning. Seven modified production source hashes matched before/after the final checks. No snapshots or test retries were used.
- No browser, portable/EXE, Windows CI or interactive multi-select validation was run here. Existing UI gates for the base are not evidence for new interaction wiring.
