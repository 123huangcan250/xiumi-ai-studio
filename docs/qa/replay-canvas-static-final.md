# Static replay canvas final-frame correction

Base `8f765c3`. This is an existing upstream canvas display defect, not a change to saved playback: exact upstream `f0c819f` uses `asAuto(block)` for ReplayCanvasBody but retains `playback.loop`, then seeks to `replayFinalTimes`. For `loop.hold=0`, the actual compiler's scene cycle equals that final time, so seeking the repeating animation lands at the next cycle start. The Windows inline-review artifact showed the original canvas as an empty grid while the separately corrected suggestion showed content.

The patch changes only the static canvas's display copy to automatic, once-only playback. Interactive ReplayPreviewModal still uses the original automatic-playback preview with its loop intact. Saved document, compile/export trigger, loop and timings are unchanged. This intentionally matches the once-only review suggestion policy without modifying the work to conceal a screenshot defect.

Two actual React/compiler component integration cases (tap and auto) failed before the change and pass after it. They prove the real original compiler has cycle==final time and indefinite repetition, the canvas copy has no indefinite repetition and is paused/seeks to final time, and the original block and export remain unchanged. jsdom mocks the SVG playback API; this is not a pixel-rendering proof.

Two independent browser scenarios are added to `replay-canvas-final.spec.ts`: real API seed, actual original canvas SVG text visibility and all ancestor opacity, paused positive time, no repetition in static canvas, repetition retained in interactive player, and unchanged saved playback. Screenshot files use `replay-canvas-final-{tap,auto}.png`. Cloud browser remains prohibited/blocked; only discovery is performed. Fresh Windows execution and screenshot inspection are still necessary.

No other worker tree, deployment, live user data or settings were changed. No new production module/dependency is introduced. Final lint/types/mixed/build results are reported at handoff; existing large-chunk build warnings are not hidden.

Frozen-source local results: full ESLint, TypeScript and production build passed. Full mixed suite:101 files,1026 passed and two platform skips (1028 total). The two browser scenarios were discovered, not executed. No existing screenshot assertion or browser timeout changed.
