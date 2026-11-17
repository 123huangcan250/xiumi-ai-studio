# Inline review visual-fixture correction

The first green Windows candidate used literal `<p>…</p>` strings as stored paragraph content. That is not the RichText storage schema: startup repaired the fixture and the screenshots showed literal markup and a repair toast. The first screenshots also used an implicit time-dependent light shell. Those runs proved their actual behavior assertions, not clean Chinese dark-design acceptance.

This test-only correction uses shared Chinese fixture text and `createBlock` + `textToRich`, with a focused normalization/idempotence regression. The original malformed fixture failed this test; the corrected fixture passes. E2E checks the persisted blocks, complete original text, absence of literal markup and absence of the repair notification before reviewing.

The full combination explicitly selects existing `xiumi-color-mode=dark`, asserts `data-color-mode=dark` and the editorial shell's `--bg:#141414`, waits for both documents' font readiness and the complete suggestion height, and records 1440/1024/390 screenshots plus full original/suggestion pair captures. It introduces no theme implementation and no document-theme changes.

The narrow candidate shares valid content and readiness checks but does not select/assert the absent PR8 dark shell. Existing responsive/image-control capability gates remain. No source production code or replay behavior is modified here; the separate original-canvas replay investigation is not addressed by this fixture correction.

Browser snapshots remain pending a new Windows run. Cloud regression/discovery does not prove the new screenshots exist or look correct. No snapshot assertion, timeout, retry or existing behavior check was removed.

## Narrow integration gate and preserved failure

After applying the unchanged original-canvas fix `81680a5`, full lint/types/build and discovery (61 cases / 21 files) passed. The first default-parallel mixed run did **not** pass: `uploadGateIntegration.test.ts:27` received 408 instead of 200 for the valid upload following an intentionally timed-out request. Its initial 408 and disk-cleanup assertions had passed. That existing real-HTTP test uses a 50ms upload deadline for both requests. No upload source, test assertion or timeout changed in this candidate. The run recorded 826 passed, one failed and one platform skip.

A diagnostic execution of the unchanged three upload integration cases passed 3/3. A subsequent complete **single-worker** mixed run passed all 827 cases with one platform skip (80 files). This supports a scheduling-sensitive deadline hypothesis but does not prove the original delay's root cause or erase the default-parallel failure. Both outputs are retained at handoff; no blind CI retry or budget increase was made. Fresh Windows default-matrix results remain necessary.

The replay correction addresses the same pre-existing f0 static-canvas loop/final-time boundary; it does not add PR8 styling, PR12 controls or any other combination feature. Browser screenshots have not been executed locally.

## Follow-up Windows evidence, 2026-11-14 UTC

PR15 f4a6022 failed on all four Windows Node jobs: 828 mixed tests passed; browser 53 passed, 3 capability skips, 5 failed. Four review cases failed because a negated text assertion still required a nonexistent toast element; the long HTML case additionally triggered the existing repair detector. Deep object equality alone missed its cause: the store compares JSON serialization, and the hand-built label/html property order differed from canonical html/label order. No product recovery behavior was changed.

The fixture now uses createBlock for HTML and an explicit replay builder. The new serialization-invariance assertion failed on the prior HTML builder and passed after canonical construction; every custom browser fixture is checked before PUT. The repair assertion requires zero matching repair toasts, whether unrelated toasts exist or not. Image readiness additionally requires positive naturalWidth; final original/suggestion geometry is rechecked after fonts and frame height settle. No timeout, retries, or business assertion was removed. Fresh Windows evidence is required; local discovery is not execution. The earlier local 50ms upload deadline failure remains recorded separately and is not explained by this fixture correction.

Follow-up local gates: full default-parallel mixed run 828 passed, 1 platform skip (80 files); lint, types, build and diff-check passed. E2E discovery 61 / 21 files, not browser execution. The build retains its existing large-chunk warning. This later green does not erase or explain the earlier 50ms parallel upload failure.
