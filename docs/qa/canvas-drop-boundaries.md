# Canvas drop and fragment boundaries: narrow follow-up

Based on exact PR16 head49c726fa35f5512507f1916e940358dcac7dea44. Only the Canvas production hunks from reviewed fix5ff5a87 are ported. No parent e05 strict infrastructure/test-layers, full combined Canvas, ImageResize or typography dependencies are introduced. Existing multiselect, inline review, strict/filter and native drag diagnostics remain unchanged.

Original narrow source failed14/14 targeted tests (plus one uncaught original error); fixed source passed14/14. Tests isolate real React event handlers and injected collaborator boundaries: invalid JSON and shape/index, absent photos, legitimate selector-special IDs, old document drag identity, and detached/moved fragment selection. Exact dataset equality replaces interpolated CSS selectors. This does not authenticate arbitrary external drag payloads or prove every cross-document ABA pattern.

Two new browser scenarios exercise malformed synthetic DataTransfer payloads against the actual Canvas and stale detached fragment UI. They are clearly synthetic robustness checks, not evidence of native mouse drag behavior; the pre-existing controlled native swap scenario and its identity/data assertions are retained unchanged. Browser execution is blocked locally; discovery only. Existing .test.ts discovery unchanged using createElement, without strict infrastructure. Types and ESLint pass. Full mixed/build results are appended after completion; fresh Windows runs remain required, not substituted by old2b57 results.

Final local gate:87 mixed files,902 passed /1 existing platform skip (903 total),91.35s; production build passed with existing chunk-size warning. Browser discovery:71 cases/24 files. Focused14/14; types/lint exit0. Fresh Windows actual browser remains pending, not counted as passed.

## Browser fixture correction

Fork Windows run [43636934661](https://github.com/Zhou-chu/xiumi-ai-studio/actions/runs/43636934661) at 970e6f0 produced the same result on Node 22.19.0 and 24: 66 passed, 4 skipped, and one failure. The new malformed-drop scenario never dispatched its payloads: it waited for a photo marker that the inline data SVG fixture could not receive. The detached-fragment case passed. A local probe of production `blockPhotos` with a DOM parser confirmed that the data SVG is decorative and a local `/media/*.jpg` source is a photo.

The spec now uploads the same tracked sample JPEG used by existing browser tests, seeds its local media path, and asserts `data-photo="0"` before dispatch. The existing payload, page-error, persisted-block, no-swap, and detached-fragment assertions are retained. No product code, timeout, or retry changes.

Local verification: 14 Canvas boundary unit cases passed; targeted ESLint, TypeScript, and two-case Playwright discovery passed. The local Chromium launch probe failed because the environment refused socket creation. The corrected browser scenarios still require fresh Windows execution.
