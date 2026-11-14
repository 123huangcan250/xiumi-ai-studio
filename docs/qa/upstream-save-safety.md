# Upstream save-safety alignment

Base: upstream `aec2e753522d1ea6dc90cb51f2080606c0e71b92` (merged PR 4).
This is a selective adaptation of fork save-safety work, not a replacement of the upstream editor or server.

## Contract

- Project GET returns an opaque revision. Legacy JSON is versioned on read without rewriting it. A successful PUT returns a new revision. New IDs may be created without one; updating an existing ID requires its current revision. A stale/deleted project returns 409 without overwriting the winning draft.
- An already-open older client that lacks revision support cannot blindly overwrite an existing draft. It receives a conflict message directing it to preserve/export its local content and reopen the project. This is an intentional protocol safety change, not transparent backwards write compatibility.
- Undo snapshots do not roll persistence revisions backwards. A conflict stops automatic retry; the explicit recovery action saves a fresh-ID copy and leaves the original untouched. Edits made during a save remain dirty.
- Queued saves and their success/failure callbacks belong to the document generation that started them. Loading a different project invalidates earlier callbacks. Navigation checks persistence before replacing the draft and refuses a delayed read if the current draft changed.
- `flushSave()` remains a rejecting Promise<void> for backup, reload and quit callers. Existing upstream explicit confirmation after save failure is retained: it is not a silent success, and choosing to continue may omit unsaved changes or discard them on exit.
- Historical restore remains undoable. Closing the dialog, starting a newer request or editing the draft prevents an older response from replacing current work.
- Startup is guarded across React StrictMode cleanup and delayed requests. This also prevents two stale initial revisions from racing an automatic normalization save.

## Add-only restore and migration

Only the project-file copy participates in the same in-process per-target queue as project GET/PUT/delete. Other categories retain their existing behavior. On Windows the queue key folds path case, matching the normal filesystem semantics.

Existing destination files still win via exclusive copy. A newly restored project receives a fresh opaque revision so a deleted draft's old token cannot revive an old writer. Article content, IDs, source files and existing local files are preserved; retrying restoration does not reset a destination's revision. Invalid project JSON is refused rather than treated as a missing draft. Only ENOENT means absent; read failures and malformed shapes preserve the original bytes.

The upstream 8 GiB compressed backup-upload capacity, portable launcher, replay features, local-first merge UI and backup routes are unchanged. This does not introduce a whole-DATA transaction, cross-process lock, rollback journal or globally atomic backup snapshot. External file writers and multiple processes sharing DATA are outside this queue's guarantee.

## Verification record

All filesystem and HTTP tests use private temporary directories; browser tests use the existing isolated E2E server/data workflow. No production DATA or deployment state is modified.

- Original upstream baseline: 591 tests passed. This existing `tests/unit` suite includes HTTP/filesystem/component integration tests; the count is not a strict-unit coverage claim.
- Watched failures before repairs: save failure returned no navigation result; old failed saves poisoned a loaded document; undo reused an old revision; blind/stale saves lacked conflict protection; delayed project and history responses overwrote newer work.
- Additional boundary failures: Windows case aliases both returned 200; malformed/falsy JSON was treated as absent; restore reused a deleted draft token; partially saved variant batches could not retry under CAS.
- First complete browser run: 42/44 passed. Two unchanged Xiumi export tests exposed a real StrictMode initialization/save race. After fixing startup ownership, both original export assertions passed; no screenshot baselines, timeouts or export assertions were relaxed.
- Focused browser verification passed for partial variant-save retry, cancelled long import, unchanged export confirmation/no-upload/no-download behavior, and cancelled historical restore followed by normal restore/undo.
- A further red/green regression test exposed a missing template-change notification when an already-issued template write finishes after import cancellation. Successful writes now broadcast their actual receipt before the ownership guard stops subsequent operations. The controlled cancellation test passes without a fixed sleep.

Latest frozen-source check: 610/610 tests and production build passed (the existing >500 kB chunk warning remains). The first final-check attempt had three fixture failures because a runner-level XIUMI_DATA_DIR overrode individual tests' DATA_DIR; no assertions were changed. Removing only that higher-priority override, retaining a private DATA_DIR and XIUMI_SKIP_ENV_FILES=1, yielded 67/67 affected tests and then 610/610 full tests. The browser run passed 47/49: two old tests read the old manuscript immediately after clicking a variant, because its truthful saved status does not mean the new variant has persisted yet. The tests now await dialog closure before their unchanged layout/theme/undo/save assertions; a controlled delayed-save/failure/retry case documents the intended save-before-switch contract. The new controlled delayed-save/failure/retry case passed individually, followed by all 50 browser tests (2.8 minutes, exit 0); targeted ESLint and TypeScript checks passed. All 108 src/server TypeScript source hashes remained identical to the 610-test check/build snapshot before and after final browser verification. The new contract test compares manuscript block IDs/content/title rather than transient DnD transition styles. No retries or longer timeouts were used. No real external model calls, packaged executable retest, strict-unit 90% result or Sonar outcome is claimed by this document.
