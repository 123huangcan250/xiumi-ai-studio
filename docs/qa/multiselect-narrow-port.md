# Narrow compatible multi-selection port

## Baseline and scope

This candidate merges the PR15 equivalent `86bd7d1` (guard, proposal safety, inline review, corrected Chinese fixtures and static replay) with the PR14 equivalent `2fe12cf` (single-selection scope synchronization). Their common proposal ancestor is `b0bfeb4`. Both branches' protections remain; this is a stacked candidate depending on PR14 and PR15, not a replacement for either.

The port applies the exact multi-selection foundation delta `0ace946` and interaction delta `b71d416`, not whole files from the full combination. Three contextual conflicts were resolved narrowly: `store.load` gains `selectedIds: []` without CAS/revision fields; Canvas gains the selection provider/bar without ImageResize; RightPanel gains `findBlock` without UiIcon. The original upstream save/startup behavior is otherwise unchanged.

Excluded: PR7 CAS/startup changes, PR8 theme/responsive shell/fonts/icons, PR11 typography controls/compiler changes, PR12 image handles/compiler widths and combined/package workflows. Package/lock/compiler/guard/proposal journal remain the merged baseline's versions. Existing ColorPicker, AI parameter warnings, replay and data controls are retained. Dark selection-control selectors are inert compatibility styling, not an implementation of a dark theme.

## Shared behavioral contract

No alternate scope semantics were introduced for this port. The same array/scalar validation rejects empty, duplicate, ambiguous or conflicting requests rather than broadening to whole-document scope. Legacy focus cannot expand into multiple requested targets. Server-owned filter/strict, ignored operation counts, subtree identity, valid removals and adjacent original-anchor insertions remain intact. State transitions prune invalid selection identities; ordinary single delete still selects its neighbor, multi-delete produces one undo entry.

Ctrl/Cmd toggle, ordinary single click, explicit keyboard/touch-style selection buttons, mixed property summary, current-scope reset and stale response ABA rejection use the same tested handlers as the full combination. The real App shortcut test is extracted into a standalone component test; it does not import the unrelated initialization-safety feature or tests.

The 390px browser case is explicitly gated by `XIUMI_RESPONSIVE_COMBINATION=1`, matching the dependency on the separate PR8 responsive shell. Desktop modifier and keyboard cases are never capability-skipped. The full combination must enable and execute the phone case. This narrow source has no ImageResize component; image drag/keyboard race coverage belongs to the full candidate `9d4ee46`, not this branch.

## Verification boundaries

Tests include real Zustand/history, React/DOM and HTTP integrations with provider mocks, not strict-unit-only coverage. No new production module was added, and all modified src/server files remain in the full denominator. Browser cases are authored/discovered in this cloud environment only; new Windows dev/portable execution and screenshots are still required. No snapshots, timeouts or retries were altered to obtain a pass.

Initial focused verification on the narrow source: six files / 70 tests passed; TypeScript exited 0. Full frozen-source results follow below.

Fresh frozen-source result: 84 mixed files, 879 passed and one existing platform skip (880 total); full ESLint, TypeScript and Vite build exited 0 (existing large-chunk warning retained). Playwright discovery lists 69 cases in 23 files. All tracked src/server hashes matched before/after. The four desktop multi-selection browser scenarios are unconditional; only the fifth, 390px responsive case has the explicit combination capability gate.

Static equality audit: aiEdit, aiSuggestion, ops, quickActions and useSelectionScope are byte-identical to full candidate `9d4ee46`; package/lock/compiler/sanitize/proposalSafety/CI workflow are byte-identical to the merged narrow baseline `438204f`. No remote CI/browser pass is claimed for this new tree.
