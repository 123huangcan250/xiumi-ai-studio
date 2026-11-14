# Explicit loopback for upstream E2E

Base: upstream `f0c819f34ad6c5134065242ddc9b1865212dc830`.

This is a test-server configuration change only. Development E2E now uses
`127.0.0.1` consistently for Vite's listening host, the browser base URL, and
both HTTP readiness URLs. The API already binds IPv4 loopback; its readiness
probe uses the existing read-only `/api/app/info` endpoint. Production binding,
Vite proxy configuration and packaged application behavior are unchanged.

The fork's public main configuration was read as reference for the IPv4 approach;
it was not copied wholesale. This candidate retains upstream's packaged mode,
`XIUMI_SKIP_ENV_FILES`, private E2E data directories, timeouts, retry policy,
workers and screenshot comparison policy.

## Evidence and limits

The new configuration-contract tests import the real Playwright configuration
under development and packaged environments without launching either server.
Before the change, the development case failed on `localhost` while the packaged
case passed. After the four-line change, both cases pass. Assertions also cover
explicit readiness URLs, Vite host, preserved environment and packaged launch.

An upstream CI run reported `workspace.spec.ts` reload `ERR_CONNECTION_REFUSED`.
This change removes hostname/address-family ambiguity. It does **not** establish
IPv6 as that failure's root cause, nor claim to cure every transient connection
failure. No retries, higher timeouts, weaker assertions or snapshot updates are
introduced.

Local browser reruns were deliberately not repeated: cloud Chromium was already
confirmed unable to start because of singleton socket EPERM in the preceding
alignment task. Real Windows E2E, including packaged execution, remains a CI/
desktop validation requirement. No screenshot baseline changed.

Final cloud checks (Node 24.22.1): lint and TypeScript passed; complete mixed
suite 71 files, 724 passed / 1 skipped (725 total); production build passed with
the existing >500 kB chunk warning. `git diff --check` passed. The environment
map is contextually typed with the official `PlaywrightTestConfig['webServer']`
type to avoid an inferred optional-undefined property conflicting with the
string-valued environment map. This annotation has no runtime effect.
