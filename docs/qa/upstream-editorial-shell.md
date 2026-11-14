# Upstream editorial application shell

Base: `aec2e753522d1ea6dc90cb51f2080606c0e71b92`. This is the first UI-only compatibility batch, not the complete fork UI or server integration.

## Scope and preservation
- The existing Toolbar and Workspace are adapted with small additions. Data/backup/migration and quit remain the original upstream actions. Narrow screens expose resources/canvas/properties and a real theme selector in both light and dark modes.
- ColorPicker and all its rich-text/per-slot consumers, `aiParameters` warnings, replay renderer, slots, compiler, AI filter/strict descendant/insert policies and server APIs remain upstream implementations. None are replaced by fork files.
- Main toolbar, resource module/kit entries, cover-design and theme controls use a shared 16px linear SVG set; original handlers and Chinese accessible names remain. Article icons are unchanged.
- Dark application chrome uses local Noto Serif SC display titles and Noto Sans SC controls, warm monochrome surfaces, a diffuse grayscale workspace and restrained frosted floating dialogs. Light theme colors remain upstream; necessary narrow-screen layout is shared.
- Authored article surfaces remain solid and content-controlled. Every added application selector excludes imported HTML, rich content and preview contents.
- `src/theme/fonts` includes both OFL-1.1 LICENSE files and PROVENANCE.json with official @fontsource-variable 5.3.1 URLs and archive SHA256. WOFF2 subsets are served locally; no Google font request is required.

## Evidence
All screenshots use a synthetic computer-systems article, route `/`, isolated `data-shell-proof`, ports 5873/5874. No production service, user article, API credential or deployment state was used.

`visual-evidence/editorial-shell` contains matched before/after 1440x900, 1024x768 and 390x844 screenshots, DataModal and a real failed migration preview of a nonexistent local directory. The failure is the actual API error, not a success/demo overlay. An AI settings screenshot is additional after-only evidence.

Observed before: narrow screens lost the canvas between two fixed sidebars; action buttons overflowed; UI fonts lacked a common role hierarchy; the toolbar repeated low-frequency actions. After: the desktop toolbar is 56px, mobile wraps to preserve actions, and all three measured viewports have document scrollWidth equal to viewport width. Resources/properties are explicit mutually exclusive mobile views; components remain mounted.

Actual Chromium CDP `CSS.getPlatformFontsForNode` reported a custom Noto Serif SC face with 5 glyphs for the Chinese DataModal heading and custom Noto Sans SC with 9 glyphs for its backup button. These are rendered glyphs, not only font-family strings. The raw result is `rendered-fonts.json`.

DataModal paths and inline code are 14px, #ECECE6 on #252524, measured contrast 12.94:1 (`data-path-contrast.json`). Paths wrap locally. The initial low-contrast code background was corrected after visual review.

An authored heading, paragraph, HTML fragment and code sample have 47 rendered nodes whose HTML/font-family/font-size/color/background stay identical across theme changes. Actual browser `compileDoc` output is also identical. A separate imported-HTML class-collision test checks modal/data-modal/hint/color-pop names do not inherit application overrides.

## Checks at this checkpoint
- Baseline: existing mixed Vitest suite 591/591 (52 files). This is not a strict-unit coverage claim.
- Final shell browser run: 9/9 passed (14.1s), including mobile scrolling/settings assertions, both original ColorPicker workflows, rendered glyphs and authored-content isolation.
- Upstream ColorPicker assertions retained: select text, common/custom/reset colors, Escape keeps text editing, per-slot colors and undo.
- Real local backup download; modal Tab containment, Escape and focus return; light-mobile real theme selection; workspace switching retains edited title/article; isolated quit interaction mocks only the terminal quit endpoint and app capability, not document save. It does not claim an actual packaged app shutdown.
- Final mixed Vitest run: 610/610, 53 files (591 existing mixed cases plus 19 isolated theme-provider cases), Node 24.19.0. Standard ESLint, TypeScript and production build passed. The existing >500KB bundle advisory remains.
- Original upstream browser suite: first full run 42/43; replay alone failed by 10 pixels because the new compatibility config omitted the upstream existing maxDiffPixelRatio=0.01. The config now directly inherits upstream.expect. With that correction the complete replay case passed (1/1, 12.7s). This is 42 full-run passes plus a corrected targeted pass, NOT a new all-43 single run. No snapshot was updated, no retry was enabled, and product source stayed unchanged. Original actual/expected/diff/error context remain in .cache/replay-initial-failure locally.
- No hardware touch or assistive screen-reader session was performed. No fresh all-43 single browser run after the harness correction, strict-unit >90%, packaged EXE, CI or Sonar result is claimed for this batch.

## Reproduction
`node node_modules/@playwright/test/cli.js test --config playwright.shell.config.ts`

The config refuses reuse of a running server, disables environment-file credentials, and uses independent data/ports. The committed tests seed their own fixtures. Screenshots labelled before were captured from the unmodified base; do not regenerate them from the modified UI.

## Remaining integration batches
Inline red/green proposal review, multi-selection, typography commands and image handles are separate behavior ports. They must keep upstream descendant/filter/strict/insert policies, slotColors and replay/ColorPicker behavior. This shell deliberately does not replace any of those contracts.

Verification manifest: visual-evidence/editorial-shell/verification-manifest.json records all 323 source hashes (including font resources), source invariance across gates, and test-file hashes/classification. The existing tests/unit directory is explicitly mixed/not strictly classified; directory names are not treated as unit-coverage proof.

## CI theme determinism follow-up
The standard `playwright.config.ts` now seeds only test-browser local storage with light mode, using the exact dev localhost:5273 or packaged 127.0.0.1:5284 origin. Product automatic local-time behavior is unchanged. CI runs the nine shell scenarios after the original E2E command with SHELL_PHASE=after; shell failure traces/screenshots have an independent test-results-shell directory included in artifacts.

Three configuration regressions failed before this patch and passed afterwards. They verify both origins and CI/artifact wiring. Standard lint/types pass. Discovery confirms 43 existing cases for both dev and packaged configs and nine shell cases. No new full E2E run or packaged EXE execution was performed for this configuration-only follow-up; remote dual-Node CI remains to be verified. Explicit webServer array type annotations resolve a latent optional-env inference error exposed by importing the configuration in the new tests; server commands and environments are unchanged.
