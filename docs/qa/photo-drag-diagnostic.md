# Photo swap regression diagnostic only

Based on 763d0dc (combined multi-selection). Remote ef0a9e failed the same existing photo-swap scenario on both Node versions and packaged EXE; 90/91 passed. Five new multi-selection cases passed but do not excuse this regression. Root cause remains unknown.

Only features.spec.ts gains passive capture listeners immediately before its unchanged dragTo and original toast/content permutation assertions. It records at most 120 events plus a dropped counter: dragstart/over/drop/end and mouse down/up, bounded block/photo identifiers, coordinates, elementFromPoint identity, first-three image boxes, scrollTop, transfer types and parsed source block/index only. It never records URLs, image bytes, text, settings, headers, credentials, or raw transfer data. No listener prevents default or changes document/selection/layout. Finally removes listeners and attaches JSON on success or failure. Attachment errors cannot override the original test failure. Diagnostic no-op on production, no product code changes.

Local validation: TypeScript, targeted ESLint, E2E discovery only. Cloud browser remains unavailable; no browser or Windows execution claimed. Existing trace evidence is preserved. Parent will run the exact scenario on isolated Windows runner, without retries or assertion/timeout changes.

## Native gesture candidate, not yet verified

Diagnostic 34a74f Windows run43624308451 reproduced3pass/1fail. Attachment recorded source mousedown at scrollTop91, target mouseup at635, and zero native drag events (dropped0). Candidate now moves16px inside source after mouse down and requires native dragstart from that exact source identity before scrolling target into view; then native mouse movement/up must yield one actual drop. No synthetic DragEvent/DataTransfer, retry, forced click, or product change. Original toast and exactly-two-content-swaps assertions remain. Mouseup is also attempted in finally for failed paths. This explicitly tests automation scroll ordering, not every real user auto-scroll path. Windows red-to-green outcome remains pending.

## Controlled Windows result and integration boundary

Exact701d9774f4705d08f936dbbb9d5a463a9d60b04f diagnostic run43625016572 passed4/4. Bounded JSON records native dragstart on source obmFPumIVW/photo0 at scrollTop91; after scrolling635, drop on distinct iaOZBPHFaO/photo0 with decoded from source obmFPumIVW/index0. Original toast and exactly-two-swap assertions passed; previous34a had zero native drag events. This is a controlled automation-gesture red/green, not full acceptance or all real-user autoscroll validation.

Integrated only test/QA changes. Normal CI and package workflow scopes remain unchanged; diagnostic-only workflow reduction is not included. Full Windows Node matrices and packaged executable gates still required on this new tree.
