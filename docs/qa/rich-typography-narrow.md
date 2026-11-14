# Narrow structured-rich-text typography candidate

Base: upstream `f0c819f34ad6c5134065242ddc9b1865212dc830`. Only the compiler typography, RichEditor controls and independent mixed-selection changes were replayed from `2b1c95e`, `01e96be`, and `d710e77`. PR7–10, HTML selection editing, and their merge commits are not included.

## Scope and font availability

The font/size attributes belong to document content, not application UI typography. The controls serialize supported text marks into the document and exported HTML. They do not change application-wide fonts, the existing ColorPicker or B/I/U controls, native replay behavior, HTML sanitization, dependencies, or the lockfile.

PR8's local Noto assets, theme provider and editorial shell are absent. Noto names are font-family preferences with fallback, **not evidence of a bundled or loaded Noto font**. On this branch they are used only if available to the rendering environment, otherwise later families/system generic fonts apply. No font is embedded in exported HTML; recipients may render differently. Actual target-font glyph loading has not been verified here.

The new controls have local `.rich-typography-*` styling; the explanatory label uses `var(--ui-text-secondary, #666)` so that missing editorial-shell tokens have an explicit fallback. This is a soft visual dependency, not a requirement to import PR8 assets or global CSS. Browser geometry/contrast on this upstream-only base still needs real validation.

HTML selection tools are deliberately excluded: their parsed HTML reinsertion safety is intended to depend on PR9, not the older upstream regex guard. This branch does not replace or downgrade any guard.

## Verification

Fresh narrow-branch Linux verification passed:
- Full ESLint and TypeScript checks.
- Complete configured mixed suite: 72 files, 768 passed and 1 Windows-only skip (769 total). This is not strict-unit coverage.
- Production build passed, retaining the existing >500 kB chunk warning.
- Playwright discovery lists all 3 new rich-typography scenarios (not execution).
- Package manifest/lockfile, ColorPicker, sanitize and replay source remain byte-identical to upstream f0.

Node 24.22.1 and the existing pnpm 11.25.0 performed frozen-lock dependency installation. The PR9 dependency tree was not reused because its lockfile differs. No Windows, browser, screenshot or EXE acceptance is claimed. Earlier stage documents retain historical combined-base TDD results, not proof that this new baseline has run. Cloud browser socket restrictions are already established; no browser launch is repeated. E2E discovery alone is not execution, strict-unit coverage, or packaged EXE acceptance.

## Windows scope correction

The first exact remote candidate `dab1c128` failed the added 390px scenario before RichEditor opened: block dblclick timed out in setup. Its other two new font scenarios passed. The upstream f0 workspace keeps 210px + 280px side panels and two 6px dividers below 1100px, so the central workspace cannot be operated at 390px. This PR does not change that existing layout.

The narrow-branch scenario is now explicitly desktop (1440px). Its font/color/keyboard/Escape/Done and no-horizontal-overflow assertions are unchanged, with no force click, retry or timeout increase. This is a scope correction, not a fix or a claim that the original phone run passed. The unchanged 390px scenario remains in the PR8-inclusive combination `8d855255`; its Windows result is separate evidence, not mobile acceptance of this narrow PR. A fresh exact-SHA Windows run is required after this test-only change.
