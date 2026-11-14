# PR9 initialization response boundary

## Scope and causal limits

Base: `e63b6f9605f8342fa46cd9723c7a3f939a9df7b3`. This ports the independently reproduced PR8 response-boundary fix (`eeddc417`) without its UI changes. PR9 retains ordinary `Error` HTTP failures and all HTML/SVG guard behavior.

Fork run 43603456933, Node 24 job 132472945463 timed out waiting for `p2` after reload in the filter-policy workspace test. The embedded report confirms the seed PUT succeeded and the title check passed before the second reload. It contains no trace, screenshot, page snapshot, console, page errors, or response bodies that establish what happened after that reload. **The precise cause of that CI failure remains unknown. This patch is not claimed to fix that specific causal chain.**

## Confirmed independent defect and fix

Previously every failed JSON body read became `{}`, including an aborted or malformed HTTP-success response. During initialization, a non-array response with no positive `length` could then enter the new-document save branch. Success-body parsing now rejects unchanged (including AbortError identity); initialization accepts only an array before deciding whether to create a document. A verified empty array still creates and saves normally. Explicit 204/205 compatibility and non-success HTTP messages are retained.

Only `trace: 'retain-on-failure'` was added to Playwright configuration. No existing workspace assertion, timeout, retry, snapshot, or address was changed. Trace artifacts are for isolated test data; no custom settings, authorization, or full-body logger was added.

## Tests

- New 11-case App/API boundary suite: baseline **5 failed / 6 passed**, then **11 passed** after the minimal fix. App rendering is exercised with mocked store/UI boundaries and controlled fetch responses; this is not a live-browser test.
- New `tests/e2e/initialization-response.spec.ts`: actual API seed and real browser fetch response wrapper inject one controlled successful-body cancellation, assert zero project writes, then reload and verify the original seed and unchanged project IDs. It is included in the normal PR9 E2E discovery path. **Not executed locally:** cloud Chromium launch is already blocked by singleton socket EPERM; no redundant retry was performed.
- Full local check/build results are recorded below. Linux verification does not replace Windows CI or a rebuilt Windows EXE.

## Local verification result (2026-11-14, Linux)

- Node 24.22.1; installed pnpm 11.25.0 (manifest continues to declare 12.6.0; no lockfile/package change).
- `pnpm check`: passed lint, TypeScript, and the complete configured mixed test suite: **73 files, 776 passed, 1 skipped / 777**. The skip remains the Windows-only case-alias serialization test. These mixed tests are not a strict-unit coverage measurement.
- `pnpm build`: passed; existing >500 kB chunk warning remains.
- No browser retries, Windows EXE build, production data access, deployment, push, or merge performed in this patch task. Windows dual-Node CI and the new browser regression remain pending publication/review.
