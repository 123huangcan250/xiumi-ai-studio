# Project initialization must fail closed on unreadable success bodies

## Confirmed defect

The shared request helper converted rejected JSON reads into `{}`, including successful responses whose bodies were interrupted or malformed. Initialization treated a falsy `list.length` as an empty collection, then created and saved a default document. Non-array JSON could enter the same unsafe branch.

The Windows CI traces showed successful seed writes, navigation/reload, and a subsequent default document, but did not capture the precise body-read exception. Controlled regressions prove this unsafe path, not that the original CI failure necessarily threw `AbortError`.

## Implementation boundary

Only `src/editor/api.ts` and `src/App.tsx` change for this repair. Successful JSON-read errors propagate with their identity preserved. Non-success HTTP responses retain their JSON error or status fallback; explicit 204/205 retain empty-object compatibility. Initialization requires an actual array before deciding that the collection is empty. A verified empty array still creates and saves the first document.

Existing color, zoom, seed, refresh, and persistence assertions are not removed or weakened. No retry, timeout increase, or snapshot update is part of this repair.

## Historical desktop evidence

Before the disk-full interruption: the initial ten cases gave five failures and five passes against the original implementation; the repair plus an additional 205 case passed 11/11. Real Chromium received real API headers with one controlled body-read rejection: original code made one unwanted project PUT; repaired code made none, and reload restored the seed and preserved the project-ID set (1/1, 7.5 seconds). ESLint and TypeScript passed. The original CI exception/timing was not established.

The interrupted desktop document became zero bytes. This cloud document and the test files were reconstructed from retained source/evidence descriptions, not copied or asserted byte-identical to the desktop files.

## Cloud revalidation

Independent worktree starts from PR8 `ffc7d3f`, merged with upstream main `f0c819f` (PR5/6). Node 24.22.1; frozen lockfile installation with available pnpm 11.25.0 (project declares 12.6.0). On that merged source the reconstructed eleven cases gave five failures and six passes before the repair, then 11/11 passed in 1.72 seconds. Complete checks and browser results will be recorded after execution; they are not implied by the focused result.

These App/API cases use real implementations with substituted fetch, store and child-UI boundaries. They are component/API integration regressions, not proof of strict-unit coverage above 90%. The browser case uses real local HTTP with controlled body-read fault injection.

Linux browser verification uses system Chromium 156.0.8078.79 via temporary uncommitted config. Existing Windows-only screenshot baselines must not be replaced or synthesized to claim Linux visual parity. Earlier shell manifests describe their historical frozen source, not this subsequent repair.

## Save-safety branch compatibility

When adapting this patch to PR7, retain active-effect, expected-document and `loadIfUnchanged` protections. Validate the array after the inactive-effect check. Adapt the mocked store to that contract; never replace its App wholesale.

Cloud static/mixed gate completed: ESLint, TypeScript and production build all exited 0. Full mixed suite: 755 passed, 1 skipped out of 756 in 34.92 seconds. The skip is the existing Windows-only case-alias filesystem test in `jsonMutation.test.ts`; Linux does not verify that Windows behavior. Build retains the existing >500 kB chunk advisory. This is not a strict-unit-only coverage measurement.

Browser execution status: discovery finds shell 10 and upstream 43 cases. A single minimal system-Chromium launch failed before opening a page with `process_singleton_posix.cc: socket() failed: Operation not permitted` and SIGABRT. No cloud browser business scenario passed at this stage; matching headless-shell availability is being checked. This environment failure is separate from the historical Windows red/green result.

The parallel PR7 verification worker reported that the official matching headless-shell download (Chromium 156.0.8078.4, Playwright build 1248) also failed with an empty/non-ZIP response and missing ZIP central directory; no usable binary was produced. PR8 did not repeat that download. Cloud shell and full upstream browser gates remain blocked, not passed. Existing Windows screenshot baselines remain untouched.
