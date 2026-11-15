# RichEditor typography controls, stage 2

> Historical development record: the combined-base counts below are not this narrow branch’s results. This branch replays only the typography changes onto upstream `f0c819f`; see `rich-typography-narrow.md` for its scope and fresh verification.
Based on stage-1 compiler commit `2b1c95e`, itself based on combined upstream `1284931`. This is a candidate, not a published UI or a completed HTML-selection feature.

## Incremental change

RichEditor adds existing Tiptap FontFamily/FontSize extensions and compact font/size selectors. Choosing the default unsets only that attribute, preserving explicit color and other marks. A selection changes selected text; a collapsed caret changes future typing. Select commands do not refocus the editor, keeping keyboard select/Enter from replacing document text. The Done button now uses click activation (including keyboard), with mouse-down prevention retaining selection.

The upstream ColorPicker source and its usage are preserved, including theme/common/custom/default colors and Escape behavior. B/I/U, highlight, lists, links and alignment commands are not replaced. Styles are scoped to RichEditor typography classes; required labels/selects/hints are 14px, selectors have mobile height adjustments. No package/lock or Vitest discovery configuration change is required.

## Validation boundaries

- A new `.test.ts` (not `.tsx`) file is discovered by the existing configuration. It mounts actual React/Tiptap in jsdom, using synthetic document JSON; four cases test selected text/reset/color retention, collapsed caret typing, Done activation, and upstream ColorPicker groups/Escape. It is **component integration / mixed testing, not strict unit coverage**.
- Initial three cases failed on the old component and passed after implementation. Additional focus assertions and the fourth ColorPicker regression passed.
- Three real browser scenarios are added under `tests/e2e/rich-typography.spec.ts` and confirmed by Playwright `--list`: persistence/undo/export; future typing; mobile keyboard/ColorPicker interaction. They use an API-seeded synthetic project and a deterministic project-list fixture. **They have not run:** cloud Chromium launch was previously blocked, and it was not retried.
- No screenshot, real glyph/loading, browser/native selection timing, or mobile geometry pass is claimed. The pending browser cases and existing text-color scenarios must run before user-facing completion.
- HTML selection controls remain stage 3; no HtmlEditor/PropsForm/slot-color/filter-policy changes were made.

Final Linux results: 86 files, **890 passed / 2 skipped / 892 total** in the complete configured mixed suite. The two skips remain Windows-only case-alias tests. Stage 1 had 85 files / 886 passed / 2 skipped; this stage adds one discovered component-integration file and four cases. TypeScript, changed-file ESLint and whitespace check passed. Production build passed with the existing >500 kB chunk warning; its production source remained unchanged during the final extra test. No coverage percentage is asserted.

## Mixed-selection follow-up

Font family and size now independently collect the attributes of text nodes intersecting each selection range. Differing values (including default versus explicit values) show a disabled `混合格式` option rather than presenting the first node as uniform. Empty selections still use current/stored attributes; choosing a font or size keeps the original Tiptap command behavior. A new real React/Tiptap component case failed against the prior first-value UI and passed after the change: mixed family/size, independent normalization, then default reset without clearing color. Focused suite is now 5/5. This follow-up intentionally did not rerun the full mixed suite or browser; parent integration will do the final full gate.
