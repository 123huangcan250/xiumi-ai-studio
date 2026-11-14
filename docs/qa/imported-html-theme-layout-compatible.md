# Imported HTML: explicit theme and controlled structure

Narrow port base `c2161c0` (PR16), independent of the article-image collection batch. Feature delta cherry-picked from full candidate `4559806` without conflicts. No publication or browser execution yet.

All historical focused/full evidence below through “Final frozen candidate gate” describes original full candidate 4559806, not a completed full gate for this narrow port. Narrow validation is recorded separately at the end.

The approved behavior extends HTML update with a known `themeId` and optional `layout: editorial|chapters`. Theme-only adapts chromatic accents and editorial fonts; it does not claim new structure. Layout performs an actual local DOM regrouping into sequential sections or heading-led chapters. No model-supplied HTML is applied. Layout without a recognized theme is rejected.

## Preservation and limits

Text, image/link resource order and opaque islands are checked during regrouping. Transparent simple wrappers may be removed; tables, SVG, unknown/class/id wrappers, background-image and complex-positioning islands remain whole. A nontransparent background remains attached to its white/light text. Entirely opaque input rejects layout rather than pretending to rebuild it. Theme adaptation precedes grouping: preserving an island's structure does not mean its chromatic accents or HTML typography are unchanged. Raster pixels, SVG geometry and arbitrary complex components are not regenerated. Existing recoloring keeps neutral black/white/gray and alpha; pre/code and SVG typography are not normalized. This is not a general accessibility/contrast proof for arbitrary authored artwork.

Existing `slots.ts` (including per-slot colors and inline nodes), compiler/sanitizer/DOMPurify and replay implementations are unchanged. New output still goes through existing render/export sanitization. Replay remains unavailable for AI update, and children cannot be replaced wholesale. Server-owned filter/strict, selected-subtree unions, remove/anchor insertion and orderInsert are unchanged.

## Stale and content safety

Theme/layout updates require exact full original HTML equality at acceptance, including image URLs, colors and structure. The existing skeleton is intentionally insufficient for these whole-HTML operations because it ignores some image URLs. Pure text-slot suggestions retain their previous independent-slot merge behavior; later unrelated text can be preserved. Existing proposal identity, structure journal and undo/redo protections remain.

HTML text context no longer slices each slot to 300 UTF-16 units. A long emoji-boundary regression covers whole-document, scalar and array selection context and real slot replacement, retaining trailing text and the image. No character-to-token approximation is introduced; provider context constraints still apply and are not silently bypassed.

## Validation status

Initial public validateOp/store/context tests: 9 failed / 4 passed on the old implementation, then 13 passed. Prompt requirement: a separate actual assertion failed before the prompt update. An initially misordered selection helper call was a test-authoring mistake, corrected before counting that existing boundary as compatibility evidence.

Focused tests include real DOM/store projection/accept/reject/undo/export and existing slot/selection/proposal suites; these are mixed tests, not strict-unit coverage. Three new production modules (`htmlTheme`, `htmlLayout`, `htmlUpdateValidation`) belong in the complete production denominator. There are no dependency changes.

Two authored Windows E2E scenarios use synthetic model responses and a data-URI image, covering actual red/green preview, acceptance/rejection, exact undo, saving, reload and HTML download. Cloud discovery is not execution. No external image/model service or credential was used. Focused regression: 118 tests across six files passed (10.82s), followed by 21/21 feature tests after correcting array-selection test parametrization so it truly passes an array rather than a repeated scalar. Full TypeScript and ESLint passed; the two browser scenarios were discovered only. Source is frozen pending independent review and then coordinated full mixed/build; Windows and portable gates are separate.

## Independent review corrections

Two public-operation cases reproduced dark-background headings losing their white foreground when theme-only or theme+layout forced the primary purple (2 red). Background islands now retain the heading's explicit/inherited foreground rather than forcing primary; this includes conservative handling of unresolved background shorthand (an additional red regression). This does not evaluate or repair arbitrary pre-existing artwork contrast.

A publisher comment previously counted as safe text and allowed wholly opaque input to be reported as restructured (a separate red regression). Only nonempty TEXT_NODE content now counts; comments are retained but cannot make an opaque layout eligible. After these corrections, all 25 feature tests passed. The earlier 118-test focused result predates these corrections; a new coordinated final suite is still required. No browser or full-suite success is claimed for this corrected snapshot yet.

After independent review, two additional public-operation cases cover image-background and legacy bgcolor islands retaining inherited neutral foregrounds. This is targeted branch evidence, not a numerical contrast certification of every color produced by harmonize, nor proof for arbitrary CSS/artwork.

## Final frozen candidate gate

A final diff check caught an unrelated insertion-index sentence accidentally copied with the fork HTML prompt. It was removed, leaving only the THEMES import and HTML theme/layout instructions; server filter/strict and insertion text remain upstream-owned. A focused regression failed before removal and passed afterward (28/28 feature cases). The earlier 1101-pass full run is retained only as pre-cleanup evidence, not the final gate.

After that correction, the exact frozen src/server manifest passed before/after equality. The complete serial mixed suite passed **105 files / 1102 tests, 2 skipped**, in **106.40s**. Production build, full TypeScript, full ESLint and diff-check passed. The build retained the existing large-chunk warning; jsdom emitted its existing navigation-not-implemented diagnostic while tests passed. Dev and packaged discovery each list **93 scenarios**, including the two new HTML scenarios; neither browser suite was run here. No strict-unit coverage percentage is claimed.

Independent review accepted the two safety corrections. Authored source, not generated cache/data or private credentials, is included. Parent still owns new Windows/portable validation and integration with the separate photo-swap regression fix; this candidate does not claim to fix that unrelated Canvas issue.

## Narrow compatibility boundary

The only automatically merged production file was core/types.ts; its change is the HTML update theme/layout metadata and comment, not full-combination font/image fields. The other feature files apply identically. No article collection, CAS, fonts, image handles, PR8 shell or package CI workflow is included. Existing slot colors, raw HTML guard/sanitizer, replay refusal, server-owned strict/filter, subtree union and anchored insertion/order contracts remain unchanged.

Narrow focused checks: six files / 125 tests passed (11.30s); full TypeScript and ESLint passed. Standard browser discovery found 71 scenarios in 24 files; no browser was run. Full mixed/build and Windows execution remain pending. Three new production modules still belong in the complete denominator; no dependency changes.
