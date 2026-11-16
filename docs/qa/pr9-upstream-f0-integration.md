# PR9 refresh onto upstream f0c819f (Linux candidate)

Parents: PR9 `21759a3c1ccf7bbf846657063172c9155da82c87`, upstream main `f0c819f34ad6c5134065242ddc9b1865212dc830` (PR5/6 merged). A separate cloud worktree was used; the shared PR7 working tree and offline Windows computer were not modified.

The merge was clean. Review compared every upstream changed server module against new main: credential error boundaries, DOCX/yauzl budgets, image limits, upload admission/disk lifecycle and JSON mutation serialization remain identical. PR9's parsed HTML guard, SVG compatibility boundary and runtime closure copying remain identical to its original head. Only a stale packaging comment claiming Sharp was the sole external dependency was corrected.

Dependencies retain exact dompurify 3.4.17, isomorphic-dompurify 3.0.0, yauzl 3.4.0 and @types/yauzl 3.4.0. Frozen installation succeeded without lock changes. Environment: Linux, Node 24.22.1, available pnpm 11.25.0; packageManager still declares 12.6.0. This does not substitute for CI's declared toolchain.

Verified:
- lint, TypeScript, production Vite build: exit 0; existing >500KB chunk warning only.
- mixed Vitest suite: 72 files, 765 passed / 1 skipped (766). The skipped case is the Windows-only same-file case-alias serialization test in jsonMutation.test.ts. This is not strict unit coverage or an all-pass claim for that Windows behavior.
- private runtime smoke bundled the complete launcher using package-win's esbuild configuration (node22/CJS, Sharp and isomorphic-dompurify external, same defines/legal comments). Metafile confirms yauzl and pend are bundled. The preserved nested runtime closure copied 55 package names on Linux. A fresh child with private DATA variables and PACKAGED=0 successfully required server.cjs without starting the launcher/listener.
- separate executable bundle assertions exercised actual DOMPurify entity-encoded javascript stripping, actual Sharp PNG output, actual yauzl valid DOCX ZIP acceptance and 413 expanded-byte rejection. No real provider/settings/data was accessed.

Browser acceptance is recorded below after its isolated window. New Windows EXE build/verification is NOT performed: the old Windows evidence belongs to 21759a3's old base, not this refreshed merge. No upstream PR/main operation or remote push occurred during preparation.

## Browser attempt in this cloud environment

One targeted run used isolated ports 5379/5380, a fresh `/tmp/xiumi-pr9-html-*` data directory, both data environment variables, SKIP_ENV_FILES=1, no server reuse and no snapshot updates. Available system Chromium 156.0.8078.79 failed before each of the three test bodies: `process_singleton_posix.cc:297 socket() failed: Operation not permitted`, then SIGABRT. Thus **0 browser behaviors verified**; these are infrastructure failures, not passed security/animation cases. No repeated system-browser attempt was made. Matching official headless-shell investigation is coordinated separately and any eventual new evidence must be recorded separately.

Logs/config/runtime smoke harness are retained under ignored `test-results/pr9-*`; runtime smoke stage `/tmp/xiumi-pr9-runtime-B22Zd1` is retained for investigation. No credential-bearing inputs were used.
