# Startup response boundary after upstream alignment

## Scope

The PR7 save-safety branch is integrated with upstream main
`f0c819f34ad6c5134065242ddc9b1865212dc830` (PR5/provider and PR6/upload work).
The sole merge conflict was the `server/dataTools.ts` import: both the shared
asset-index `mutateJson` transaction and `restoreProjectFile` revision boundary
are retained. No DATA, desktop deployment, or upstream main is changed here.

A successful HTTP response whose JSON body fails to decode or aborts must not
be converted into `{}`. A project-list response must actually be an array before
startup can treat it as an empty installation. The inactive-effect check remains
before shape validation, and the expected-document/loadIfUnchanged guards remain.

HTTP failures still produce `ApiError` with the HTTP status and available error
message, including non-JSON/null error bodies. Successful 204/205 operations keep
the prior `{}` result without attempting to parse a nonexistent JSON body.

## Regression evidence

On the merged, unfixed cloud candidate, the initial 15 API/App tests produced
10 failures and 5 passes. Failures included successful-body AbortError/SyntaxError
being swallowed, `{}`, `{length:0}` and empty-string lists creating a project,
204/205 incorrectly reading JSON, and a null HTTP-error body losing `ApiError`.
After the minimal fix those 15 passed. Two additional tests cover an inactive
startup effect and edits made while the project list is pending: final 17/17.

`apiResponseBoundary.test.ts` exercises the real API client with a controlled
fetch boundary. `appInitializationBoundary.test.ts` is **component integration**,
not strict unit coverage: real App startup, API client, and document store run
with isolated leaf UI and controlled network responses. A real `[]` causes one
first save and records its revision. Malformed/aborted bodies cause zero writes
and preserve the current document. No coverage percentage is inferred.

`startup-invalid-response.spec.ts` seeds a project through the real local API,
allows a successful project-list HTTP response but rejects its body in the
browser, asserts zero PUT requests and unchanged persisted ID/title pairs, then
refreshes without the injected failure and verifies the same saved title.
This browser test is included for execution, **not claimed passed locally**.

## Cloud execution limits

Cloud environment: Linux, Node 24.22.1, available pnpm 11.25.0 (repository declares
12.6.0). Frozen lockfile installation succeeded without changing lock contents.
The stock tsx CLI cannot create its IPC socket in this environment. A temporary,
uncommitted Playwright config using `node --import tsx server/index.ts` starts
the isolated API. Repository Playwright configuration and assertions are unchanged.

System Chromium fails before page creation with `process_singleton_posix.cc:297`
`socket() failed: Operation not permitted`, also on the permitted escalated run.
The official matching Playwright headless-shell download (v1248) returned invalid/
truncated archives and could not be installed. No security bypass flags were
added. Therefore the browser regression and full E2E require a working browser
on CI/desktop; no browser RED/GREEN is claimed from these environment failures.

Visual baselines are Windows-specific. Cloud attempts use
`--update-snapshots=none`; no Linux baseline is generated or substituted.
Portable Windows packaging/deployment is outside this cloud verification.

## Final cloud checks

`pnpm check` passed lint, TypeScript, and the full mixed test suite: 77 files,
757 passed / 2 skipped (759 total). `pnpm build` passed with the existing
large-chunk warning (>500 kB). `git diff --check` passed. These checks do not
replace the blocked E2E/Windows visual verification or strict-unit coverage.
