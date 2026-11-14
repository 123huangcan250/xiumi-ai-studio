# Upstream minimum Node compatibility

## Scope

The application minimum remains Node >=22.19.0 (including undici 8). No test assertions, timeouts, or test selection are weakened. The only additional production change is the separately authorized image-background selector compatibility fix described below.

## Engine evidence and dependency selection

The previous installed jsdom 30.1.3 declares `^22.22.2 || ^24.15.0 || >=26.0.0`, which excludes the declared minimum. Official npm metadata for 30.0.0 and 30.1.0 has the same restriction. This is an engine-contract failure, not a claim that every operation necessarily crashes on 22.19.

Official jsdom 29.1.1 declares `^20.19.0 || ^22.13.0 || >=24.0.0`. Pin it exactly. There is no published @types/jsdom 29; use exact 28.0.0 and verify typecheck. A preliminary 28.1.0 candidate was replaced by the nearer compatible major 29.1.1 before final testing.

## CI

Every existing verification step is retained for both matrix entries `22.19.0` and `24`, with fail-fast disabled. Failure artifacts include the Node version. Action SHA pins are copied from the owner's already verified workflow, not guessed. No test is skipped or allowed to fail.

## Local evidence

Isolated official Node 22.19.0 binary, no global runtime replacement:

- jsdom 29.1.1: unmodified Playwright collection exits 0, 43 tests in 16 files.
- No loader preload is needed by this upstream test graph. Do not copy the separate fork's isomorphic-dompurify preload, a dependency this project does not have.
- Full minimum-version unit verification: 583 passed / 2 failed (585 total, 50 files, 58.76 seconds). Failures are stalled response-body deadline in fetchBoundaries and malformed string insertion position in quickActions. These are reported to the owners, not hidden as dependency successes.
- Node22 typecheck exits 0 with exact @types/jsdom 28.0.0.
- Full check, browser suite, build, and both remote CI matrix jobs: pending integration verification.

Known probe: jsdom 29.1.1, like 28.1.0, returns zero for a CSS attribute substring selector containing `url(` in a tiny document. Existing image-background tests must remain intact to catch any resulting compatibility regression; the original component suite reproduced two failures. With explicit authorization, images.ts now selects [style] and applies the original case-sensitive includes filter before the unchanged URL regex. Original assertions are intact, and an added real-DOM regression verifies lowercase background rewriting, uppercase-only exclusion, and untouched other styles. Both suites pass 55/55 on Node22.

Both the preliminary 28.1.0 and final 29.1.1 dependency audits report one pre-existing moderate minimatch advisory GHSA-g3hv-75wg-m249 in development lint tooling. No new high or critical advisory is present. It is not evidence of a production HTTP vulnerability or a new Sonar finding.