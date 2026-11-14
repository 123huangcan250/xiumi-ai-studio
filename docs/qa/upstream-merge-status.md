# Upstream reliability refresh: local preparation

This isolated worktree starts at existing upstream PR #4 head 675c1e8df367f945574dc8df31e50fbd8976828d and merges current upstream main 799f7cd61012fe8efedbb47ee3529e3a0dd9b130. It has not been committed, published or verified yet.

Two conflicts were resolved without taking one whole side: ops retains fresh identities and anchored insert validation while preserving upstream's prohibition on AI replay insertion/update (including nested replay payloads); store imports preserve both TOP_ONLY and SelectionPolicy. Added replay-boundary regression tests are not yet run.

Next steps:
1. Install this tree's own frozen dependencies and run typecheck plus selection/replay regression tests. Review automatic merges in compiler, Canvas, server/app, Toolbar and wechatOutput, not just conflict markers.
2. Re-read the owner's ten review points against this PR's actual filter/strict policy. Do not blindly transplant the fork's newer strict update-only policy into an unrelated upstream contract.
3. Port the confirmed whitespace, same-origin metadata, suggestion cancellation and effort-rejection fixes with their tests; retain replay/render/export behavior and current paste fluidization.
4. Run the upstream project's full checks and browser tests, with an independent data directory and ports. Do not reuse the fork's 120-source coverage report as proof about this larger source tree.
5. Only after the fork main/CI delivery has passed, update existing PR #4 without force-overwriting unrelated remote work. Plan the editorial/new-editing contribution separately if combining it would obscure this review.

The upstream 8 GiB backup/extraction and additional Sharp/replay paths are not covered by the owner's 30 MiB fork upload risk acceptance. Native replay output and imported HTML/SVG have different sanitization paths; do not claim that preserving unsafe HTML is necessary for all replay. No global permissions, services, production data or remote refs were changed by this preparation.

Preparation verification: frozen install succeeded with the upstream-declared pnpm 12.6.0. Four focused replay/selection suites passed 67 tests. The added test fixture initially used a string instead of RichText; it was corrected to the actual default paragraph constructor, then typecheck and its 3 tests passed. The original upstream Chinese replay error is preserved. Full upstream suite, browser and export/package compatibility are still pending; no commit or publication has been made.

Review follow-up: see `upstream-review-feedback-map.md` for the ten original owner points, adapted changes, red/green evidence and unresolved policy/CI items. Worker did not commit or publish the merge; original staging is intact.

Final coordinator gate: 587/587 Node 22.19.0 unit tests, lint and typecheck passed; production build, development E2E 43/43, portable verification 25/25 and packaged E2E 43/43 passed. Runtime bundle now 22.19.0, checked against official SHA256. Prior pending/failed worker snapshots above are historical. Remote CI and full editorial integration remain separate.
