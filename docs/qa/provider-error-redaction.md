# Provider error credential reflection boundary

Upstream follow-up based on aec2e753522d1ea6dc90cb51f2080606c0e71b92 (merged PR #4). This ports the already-tested fork error-boundary patch without replacing upstream AI protocols, portable logging, backup/migration routes, selection policy, or cancellation behavior. Existing launcher logging registration is unchanged (there is no dynamic addSecret call in the upstream ai/aiModels modules); this error-response boundary is complementary, not a replacement for log redaction.

## Behavior

Generation, direct/draft model discovery, and effort probe failures redact the active credential before leaving the provider boundary. Raw, JSON-string-escaped, and encodeURIComponent representations are replaced, including credentials without an sk prefix. Fresh errors retain only sanitized name/message, finite numeric or sanitized string code, and integer HTTP error status 400-599. Provider stack, cause, and arbitrary properties are not retained. Caller cancellation keeps its original reason identity; provider AbortError keeps the established 504 timeout. Null/undefined/string throws are normalized without a secondary TypeError.

This is exact active-credential reflection protection, not a universal secret detector: unknown secrets, arbitrary obfuscation/base64/double encoding, hostile getters/toString, and successful provider content are outside this change. No real credentials were read or sent.

## Upstream verification

- Existing upstream behavior: 14 boundary regression cases produced 11 failures and 3 passes before the fix. Failures included reflected credentials, retained raw causes/stacks, and null/undefined/non-Error rejection handling.
- Adapted fix: 31/31 focused tests passed (17 pure helper cases and 14 mocked-provider cross-function cases).
- Node 24.19.0: complete ESLint and TypeScript checks passed; repository test command passed all 622 tests in 54 files; production Vite build passed with the existing large-chunk warning.
- These 622 tests are the repository's mixed suite, not a claim of strictly isolated unit coverage. No coverage percentage is asserted for this upstream candidate.
- Complete Chromium E2E: 43/43 passed in 3.0 minutes, with --update-snapshots=none. Test servers used the upstream isolated ports/data directory with env-file loading disabled. Provider interactions in this suite are synthetic, not live credential calls.
- No live provider key, user data, deployment, packaging, remote CI, or Sonar execution was part of this local patch verification.

## Coverage scope

The new production helper server/providerError.ts belongs in the complete upstream source denominator. Fork historical source counts and percentages do not describe this different upstream tree. providerErrorBoundary.test.ts combines settings resolution and provider paths with substituted network calls: its tests/unit location does not make it strict unit coverage.
