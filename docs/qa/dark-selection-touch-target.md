# Dark selection touch target correction

The combined PR8 stylesheet loads after styles.css. Its dark generic button selector overrides the less-specific light selection rule with 32px. The existing more-specific dark selection rule now explicitly retains 44px. No operation, timeout, retry or capability gate changes.

A new JSDOM test injects actual CSS imports in main.tsx order and checks computed min-height. Full candidate: light passed, dark failed with 32px; after the fix both pass. The narrow candidate lacks editorial-dark.css and already computes 44px in both modes; its same rule addition prevents the eventual combination regression, not a separately reproduced narrow defect.

Windows browser assertions now measure actual selection button bounding boxes in the 1440/1024/390 dark inline-review cases, and the 390px explicit multi-selection flow. Existing narrow responsive capability skips remain. These new browser assertions have NOT run locally: cloud Chromium is unavailable. JSDOM computed min-height is not physical layout or touch-device evidence; exact Windows/EXE validation remains required. Prior all-green CI and the observed undersized dark screenshot are retained as history, not overwritten.

Verification: 8 focused tests, complete mixed suite (85 files: 883 passed / 1 platform skip), targeted ESLint, full TypeScript check and diff-check passed. E2E discovery only; no browser execution. Existing jsdom navigation-not-implemented warning remains from the Canvas interaction test.

## Narrow Windows capability correction
Exact 9a775e4 failed all four Windows jobs with 884 mixed passes, 64 browser passes, 4 skips and one failure: inline-review line 42 expected a dark root attribute, but narrow upstream has no ColorModeProvider at all. This was a test scope mistake, not a failed 44px bounding box: that assertion had not yet executed. The earlier suggestion that narrow includes ColorMode was incorrect. Dark setup/assertions now require the explicit XIUMI_RESPONSIVE_COMBINATION=1 capability. Narrow desktop continues all original review/history/save and bounding-box assertions in its existing theme; existing responsive skips remain. No runtime auto-skip, product theme, timeout or retry change. Full combination still unconditionally requires dark. New exact Windows results remain pending.
