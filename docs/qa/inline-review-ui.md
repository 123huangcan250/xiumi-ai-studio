# Inline proposal review (combined candidate)

## Scope and contract

This narrow candidate combines upstream f0 with complete PR13 (`7dcef657`) and PR9 (`79c984f`) dependencies, then ports only UI delta `8f765c3`. It does not include PR7 save/CAS, PR8 shell/fonts, PR11 typography, PR12 image controls, PR14 selection synchronization, or package-verification workflows. Existing upstream API, color picker, selection policies and replay are preserved. The dependency merge de-duplicates identical retain-on-failure trace keys; all loopback settings remain from PR13.

- Original live modules remain mounted. A red overlay marks their entire bounds without intercepting pointers. Full green suggested modules appear below, with readable solid-white work content and a lightly blurred green chrome background. Accept (green) and Reject (red) are explicit 14px controls with 44px minimum height.
- Side-panel item list is removed. Summary, filter-policy explanation, ignored/error counts, accepted/rejected/pending totals, batch actions, preview and close remain. Existing E2E operation-count assertions now count real inline cards; accepted/rejected assertions use the summary totals. Content and policy assertions were not removed.
- Every individual display is one `resolveProposalItems` projection. Its actual inserted identity locates the insertion; no separate validation/rebase algorithm or new ID is used for display. Acceptance always calls the store with the captured proposal identity, not cached HTML. The existing appliedStructure journal, orderInsert, field-stale logic, undo/redo and filter/strict semantics remain authoritative.
- Delete has an explicit no-replacement explanation. Move shows the complete moved module and destination index. Metadata shows full old/new values. Theme shows complete old/new compiled document previews. Missing/stale targets remain rejectable at the article end.
- Overlapping box/child cards are lifted below the enclosing marked original, so the parent's red layer does not tint a green suggestion. Upstream only permits **one box layer** (`tree.ts` and normalization); this patch does not introduce arbitrary nested editing or expand validation policy.
- Preview HTML is compiled and DOMPurify-guarded inside a script-free, pointer-inert iframe. No editable work DOM is copied back. CSP forbids scripts, objects, nested frames and forms; images allow self/data/HTTPS and fonts self/data. ResizeObserver, image load and font readiness update preview height without a fixed maximum clip.
- Tap replay is rendered from a display-only automatic-play copy, then frozen at upstream scene final times by the owning editor. This is explicitly labeled static final artwork. Native original/exports retain their playback configuration. No script permission or link interaction is enabled in the iframe.
- Necessary preview content also has an auxiliary plain-text reading disclosure. This is not a claim of full screen-reader or physical-touch certification.

## Verification

Behavior-first local tests cover pure full projection/history immutability, stale suggestions, actual insertion placement, nested target/delete and move-journal semantics; actual React wrapper node/focus survival, duplicate action history, stale accept/reject, review event isolation and guarded/export-separated content. Separate red/green cases cover parent/child card placement, metadata/theme views, renderer failure isolation and tap replay display versus unchanged export.

The original component node test uses a focused input as the stable child. It does **not** alone prove the full editor: added Windows browser cases separately exercise a real mounted rich editor during proposal creation and typing, and real image controls while a long image/font-dependent suggestion is shown.

Added browser sources: 1440×900, 1024×768 and 390×844 full red/green screenshot evidence; original node identity; keyboard acceptance/undo; 44px targets and page horizontal bounds; persistence without review artifacts; insert/delete; long suggestion/image/font height; original image-resize interaction; real rich-editor preservation and stale typing. These are discovery-only in cloud until Windows CI runs. Existing Windows visual snapshots are unchanged.

Cloud Chromium cannot launch in this environment (previously established socket permission failure). No new browser attempt, screenshot, Windows/EXE test or real-model API claim is made here. Synthetic provider browser fixtures are not live model verification. Full test totals below are a **mixed** suite, not strict unit coverage >90%.

## Remaining validation

Windows full dev, shell and real packaged EXE gates must run on this exact candidate. Inspect actual three-width screenshots, very long suggestions, nested parent/child presentation, responsive focus/scroll and final replay frames. No push, upstream PR, deployment or user DATA mutation is part of this local change.

## Original combination gate (historical, not this narrow candidate)

- Focused review suites: **15 passed**, including recorded red/green cases above.
- Complete Vitest mixed suite: **100 files, 1024 passed, 2 Windows-only skipped** (2026-11-14 UTC cloud run). No strict-unit coverage percentage is inferred.
- Full ESLint and TypeScript: exit 0. Vite production build: exit 0, with the existing >500KB chunk warning.
- Playwright discovery: **84 cases / 28 files**, including seven new inline-review cases. This is discovery, not browser execution. No snapshot baseline updated.
- Display replay additionally strips source-authored `data-review-freeze`, uses per-projection UUID/out-of-band times, rejects invalid or >24-hour preview times, disables looping only in its copy, and reports unsupported SMIL freezing without stopping height measurement. A static code review is not proof of actual Windows tap/loop rendering; the new browser case remains mandatory.


## Narrow capability boundary

`InlineReview` does not import or inject PR8 font resources. Work previews use `rootStyle(theme)` and existing font fallbacks; UI controls use `var(--font-ui,sans-serif)`. No Noto-local-loading claim is made. No sanitizer, DOMPurify dependency or runtime closure is removed.

The 1024/390 cases and the original-image-handle case remain intact but explicitly require `XIUMI_RESPONSIVE_COMBINATION=1` and the full PR8/PR12 combination. Ordinary narrow CI skips these three capability cases instead of force-clicking hidden controls or claiming mobile support. Desktop acceptance/keyboard/undo, insert/delete, rich-editor node retention, tap+loop preview, and a separate full long-image/font-height case run on the narrow target. The already published combination keeps its original seven UI cases unchanged.

This is a dependency-stacked local candidate. Until PR9 and PR13 merge, a main-targeted upstream PR would include their changes; after they merge, rebase/refresh to show only the UI delta. Windows and EXE verification must use the exact narrow head; historical combination results are not substituted.


## Narrow candidate verification

- Complete local mixed suite: **78 files, 824 passed, 1 Windows-only skipped**. This includes all 15 review-focused regressions and unchanged PR9/PR13 suites; it is not strict-unit >90% coverage.
- Full ESLint and TypeScript: exit 0. Production Vite build: exit 0; existing >500KB chunk warning remains.
- Playwright discovery: **59 cases / 20 files**. Three UI capability cases are explicitly gated in ordinary narrow runs; no actual browser result is claimed from discovery. The five applicable new desktop cases are acceptance/keyboard/undo, insertion/deletion, actual rich-editor identity/stale typing, tap+loop static replay, and long loaded-image/font sizing.
- `pnpm-lock.yaml` matches the existing PR9 installation byte-for-byte. The shared node_modules symlink is untracked; no dependency downgrade or package workflow added.
- Merge ancestry: `7dcef657` (PR13) plus `79c984f` (full PR9). UI delta only then applied. Canvas conflicts were resolved by adding review wrappers without importing or mounting missing PR12 image controls. RightPanel's current request/scope code outside the item-list replacement is unchanged.
- No push, upstream PR, browser launch, Windows EXE run, main/CD action or user data access performed.
