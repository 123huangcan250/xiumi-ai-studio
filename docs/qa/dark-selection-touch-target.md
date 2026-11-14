# Dark selection touch target correction

The combined PR8 stylesheet loads after styles.css. Its dark generic button selector overrides the less-specific light selection rule with 32px. The existing more-specific dark selection rule now explicitly retains 44px. No operation, timeout, retry or capability gate changes.

A new JSDOM test injects actual CSS imports in main.tsx order and checks computed min-height. Full candidate: light passed, dark failed with 32px; after the fix both pass. The narrow candidate lacks editorial-dark.css and already computes 44px in both modes; its same rule addition prevents the eventual combination regression, not a separately reproduced narrow defect.

Windows browser assertions now measure actual selection button bounding boxes in the 1440/1024/390 dark inline-review cases, and the 390px explicit multi-selection flow. Existing narrow responsive capability skips remain. These new browser assertions have NOT run locally: cloud Chromium is unavailable. JSDOM computed min-height is not physical layout or touch-device evidence; exact Windows/EXE validation remains required. Prior all-green CI and the observed undersized dark screenshot are retained as history, not overwritten.

Verification: 8 focused tests, complete mixed suite (85 files: 883 passed / 1 platform skip), targeted ESLint, full TypeScript check and diff-check passed. E2E discovery only; no browser execution. Existing jsdom navigation-not-implemented warning remains from the Canvas interaction test.
