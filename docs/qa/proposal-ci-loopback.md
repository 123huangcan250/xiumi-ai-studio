# Proposal CI loopback and failure evidence

Narrow proposal candidate `4eb896d44b8586bd275401ac0152d8dd5b8ef6ea` passed fork
Node 22/24 and upstream Node 22. Upstream Node 24 (run 43613636371,
job 132503866461) failed the existing `workspace.spec.ts:191` reload with
`net::ERR_CONNECTION_REFUSED`: 46 passed / 1 failed. All four new proposal cases
passed. The artifact had an HTML report and error context, but no trace or failed
connection IP. A separate backend project-file rename EPERM was logged; no causal
connection to the reload failure is established. IPv6 is not a proven cause.

This patch applies the already reviewed PR10 test-only loopback configuration:
Vite listens on 127.0.0.1, and development navigation plus both readiness probes
use explicit 127.0.0.1 addresses. Production binding, API proxy, packaged launch
environment, timeouts, retries, screenshot tolerances and behavior assertions are
unchanged. This removes addressing ambiguity, not proof of the old root cause.

Both modes now retain failure traces, collected by the existing test-results
artifact upload. Fixtures are isolated synthetic data, not user credentials.

## Validation

- Config contracts: old config 3 failed / 1 passed; final config 4 passed.
- Full ESLint and TypeScript passed.
- E2E discovery: 47 tests in 17 files; no browser execution.
- No production or proposal-safety source changed. No old CI retry requested.
- Fresh exact-commit Windows CI remains necessary. Cloud Chromium has a previously
  confirmed socket restriction, so browser launch was not attempted again.
