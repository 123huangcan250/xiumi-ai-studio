# Upstream editorial shell compatibility plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adapt the previously approved monochrome editorial UI to upstream aec2e753 without removing upstream functionality.
**Architecture:** Scoped application color-mode, local fonts, responsive shell. Keep article rendering and all business APIs unchanged; adapt existing components rather than wholesale replacements.
**Tech Stack:** Existing React/TypeScript/Vite, local Noto WOFF2 fonts, Chromium.
**Spec:** User-approved shared black/white design, updated rounded Liquid Glass overlays and diffuse grayscale outer background.

## Constraints
- Preserve DataModal, data/quit actions, ColorPicker consumers, ignored-parameter feedback and replay UI.
- No server, proposals, multiselection or AI scope-policy changes in this batch.
- Article background, typography, images and exports remain content-controlled.
- Test data only in this worktree, ports 5873/5874; no credentials or production data.
- Necessary controls >=14px; 12px only optional metadata. Visible focus and semantic errors.

## Review focus
Long Chinese titles; narrow workspace selection/scroll retention; modal/ColorPicker Escape; actual Chinese font glyph usage; theme-independent compiled article.

## Tasks
- [x] Seed long synthetic document through real API; same-route/content before screenshots at 1440x900, 1024x768, 390x844, data/settings dialog and reproducible failure.
- [x] Run baseline checks and record any failures.
- [x] Port local fonts/provenance and color-mode helpers; wire without changing article renderers or upstream light mode.
- [x] Adapt workspace switching/toolbar overflow retaining all upstream actions.
- [x] Apply scoped warm-gray surfaces and frosted dialogs with reduced-transparency/forced-colors fallback.
- [x] Browser assertions for glyphs, document invariance, keyboard, dialogs, failure and persistence.
- [x] Inspect same-view after screenshots, then lint/types/tests/build and relevant existing browser tests.
- [x] Record precise gates and remaining gaps; isolated commit only, no push/deploy.

Final ruling: preserve upstream screenshot tolerance by inheriting upstream.expect rather than redefining it; first full E2E had 42 passes and one 10-pixel harness-configuration failure, then replay targeted passed. No product-source fix, snapshot update or retry. Final test evidence and limitations are in docs/qa/upstream-editorial-shell.md.
