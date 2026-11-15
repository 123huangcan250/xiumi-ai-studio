# Version actions: narrow safety follow-up

Based on exact PR7 head a60ca7080c2d2dde474c5913292d65852b112648. Only the VersionsModal production hunks from reviewed fix83e6265 are ported; no strict test-layer infrastructure, theme or full combined Toolbar replacement. Save CAS and export/replay behavior remain untouched.

The same narrow test source was run against original production code: 12 failed / 3 passed, with five original unhandled promise errors. Applying the production fix produces 15/15 passing React handler-boundary tests. These cover synchronous duplicate admission, pending save/restore rejection, cleanup/unmount, same-render ABA, document/list generation and explicit retry. They are not live browser or full-source coverage measurements.

Two new actual browser scenarios are authored: deferred save with double click, failure feedback and successful real API retry; close during deferred restore with persisted winning content and reload. They are discovered but not executed in cloud because browser startup is blocked. Existing full browser cases stay intact. Unit tests use createElement in .test.ts so original discovery config is unchanged.

TypeScript and full ESLint exit0; ESLint reports one react-hooks/exhaustive-deps warning on the intentional generation ref increment during effect cleanup, inherited from the exact reviewed production fix. This is disclosed, not reported as zero warnings. Full mixed/build results recorded below after completion. Fresh Windows browser/EXE validation remains required; prior2b57 pass does not cover this new source.

Final local gate: 78 mixed files, 772 passed / 2 existing platform skips (774 total), 63.69s; production build passed with existing chunk-size warning. Browser discovery:53 cases/21 files. New focused boundary cases15/15. No Windows run yet for this candidate.
