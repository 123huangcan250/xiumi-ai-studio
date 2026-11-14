# Multi-selection interaction integration

> **Provenance note:** This file records the original full-combination implementation and its historical gates. The current narrow port deliberately excludes image handles, responsive/theme shell, typography and CAS additions. Its actual dependencies, exclusions and fresh verification are in `multiselect-narrow-port.md`; historical counts below are not narrow-source results.

Dependencies: combined `f444608`, protocol/state foundation `0ace946`, and unchanged inline-review UI `8f765c3` (locally cherry-picked as `2884578`). This is a local integration candidate, not a published PR or a verified Windows/portable release.

## Interaction contract

- Ordinary article-body click retains single selection. Ctrl/Cmd click toggles membership. Blank canvas and explicit Cancel Selection clear it.
- A visible **多选模块 / 完成多选** control works without a physical modifier key. In this mode each block has a native button with a unique accessible name and `aria-pressed`; both touch/click and native Enter/Space activation work through the same action. These are editor-only controls, absent from stored/compiled content.
- Buttons, links, input/textarea/select, editable content, button/slider roles do not bubble into outer block selection. Modifier double-click does not start an editor. Drag activators and inline review controls retain their existing handlers.
- Multiple selected blocks show a mixed-properties summary, not the last selected block's editable fields. It lists content summaries and explicit batch delete/cancel controls. No generic bulk property editing is implied.
- Delete/Backspace outside typing/dialogs uses the same atomic delete action. Single selection retains existing neighbor selection. Multi-delete is one history entry; undo/redo does not revive old proposals.
- Image-resize controls hide and cancel their temporary inline styles whenever membership is multiple, even if the primary image ID is unchanged. A synchronous selection revision also rejects old keyboard/pointer handlers across same-event membership changes and multi-selection ABA; active drags restore their original inline style immediately. Ordinary one-image behavior and its existing DOM identity/keyboard checks are retained.
- Entering actual text/fragment editing still narrows to one target through the store contract. Group dragging is not implemented or claimed; choose a single block for the existing drag/reorder controls.

## AI scope and privacy

The hook observes the canonical set of `[id,type]` members plus document identity, while its synchronous transition epoch still records intermediate changes. A+B -> B -> A+B is obsolete even when React renders only the final state. Ordinary content changes do not reset manual whole-document scope. A set membership change does, including when the primary ID stays the same.

RightPanel sends the list via `selectedIds` while keeping the scalar primary in the old parameter. Model result application uses the same array boundary and retained server filter/strict policy. The existing proposalVersion, document-reference guard, rendered-token preflight, suggestion cancellation and stale error/finally protections remain intact. This does not add end-to-end cancellation of the edit request itself.

Single-selection automatic-suggestion context remains the previous single-block payload. Multi-selection uses original top-level indices, containing boxes and summary-only other modules to validate insertion anchors. The opt-in disclosure now explicitly states that containing-box content and other-module summaries may be included as layout context; this must not be described as sending only selected words. Images are not uploaded by this feature.

## Evidence

- Four new real-React RightPanel cases failed before the UI/hook changes, then passed: membership with unchanged primary, mixed properties, request list/late membership ABA, and old-render-button preflight.
- Canvas integration: three new cases failed on the old handlers, one old editing guard case was already green; all pass after explicit pointer/mode controls. A further test proves unchanged compiled article bytes and document identity through selection mode.
- Real App keyboard integration and ImageResize pending-drag integration both failed before their minimal changes, then passed. Existing typing/dialog/neighbor, image undo/DOM-style assertions remain.
- Three additional image-handle same-event membership/ABA cases failed before the synchronous revision guard, then all 28 image DOM integration cases passed. Independent review then identified that an ABA ending at the original selection could leave the revision ref ahead of React without a new render. A fresh-event recovery case failed; explicit revision state now schedules the next render while the synchronous ref still rejects the old event. All 29 image DOM cases passed, including the next independent keyboard action without repicking or geometry changes. Existing document-change notification, undo and style-restoration assertions remain intact.
- These are component/store/API integration and mixed tests, not a strict-unit coverage claim. No new production module was added.
- Five browser scenarios are authored: modifiers/delete/history/save-refresh; selected-union model response and inline accept/reject; late membership ABA; 390px no-modifier mode with mixed properties/no overflow/screenshot; native keyboard activation and input Backspace isolation.
- Browser scenarios are **discovery only in cloud Linux**. No browser, touch hardware, actual Mac or packaged executable execution was performed for this source here. Final Windows dev and portable CI must execute them; old source's browser results are not substitutes.

## Verification

Final frozen-source verification: 102 mixed test files passed, 1,069 tests passed plus two existing platform skips (1,071 total). Full ESLint, TypeScript and Vite build exited 0, with the existing large-chunk build warning. Dev and packaged E2E discovery each found 89 cases in 29 files, including the five new multi-selection scenarios. Six modified production-source hashes matched before/after verification. No snapshots were updated, no CI retries or remote writes performed. The original article/export HTML, authored typography, replay, ColorPicker, proposal resolver and core/server policy implementation are not replaced by this UI batch.
