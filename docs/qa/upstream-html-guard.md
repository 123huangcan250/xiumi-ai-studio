# Upstream parsed HTML rendering boundary

Base: aec2e753522d1ea6dc90cb51f2080606c0e71b92. Only the final stored-HTML guard is changed. The import sanitizer, slot editing/color APIs, fluid import, native replay compiler and glyph routes are not replaced.

## Policy

DOMPurify 3.4.17 and isomorphic-dompurify 3.0.0 are pinned. The wrapper declares Node ^20.19 / ^22.12 / >=24 and separate Node/browser exports; the project minimum remains 22.19. Default DOM clobbering protection stays enabled. Normal unique IDs keep their names. Names blocked by DOMPurify (including target/location), duplicate IDs and whitespace IDs are not retained; ambiguous or missing local references are removed instead of arbitrarily binding the first match. This intentionally changes malformed input, not valid local click/replay wiring. References are checked after initial purification, including inline paint references and cascaded removal of referenced animations. Single-fragment validation does not prevent cross-module ID collisions.

Parsed SVG animations permit explicit numeric/geometry/transform/dash and color attributes, with separate value checks. URL/event/style/identity mutation is rejected. An animation with an external or invalid target is removed, not silently retargeted to its parent. Safe local targets, SMIL id.click / begin / end timing, static clock timing and valid colors remain. The temporary hook is removed by exact identity in finally; it does not grant trust based on input attributes. foreignObject HTML is recursively purified with its proper namespace. A final purification protects the serialization/reparse boundary after restrictive reference cleanup.

Ordinary safe external hyperlinks and existing inline publication CSS remain. This is not a CSS privacy/remote-resource sanitizer; arbitrary CSS resource loading and cross-fragment namespace design are not claimed solved. Native generated replay keeps its existing independent path and needs its own separately reviewed trust changes.

## Verification and packaging

- Initial 25 safety/compatibility cases: 17 failed / 8 passed on upstream guard before implementation. Fixture mistakes were corrected before recording this result.
- Additional dangling-animation, inline-paint and fallback/multiple-URL reference tests failed before their fixes. Some malformed SMIL values were already removed by DOMPurify, leaving inert nodes; whole-node rejection is policy hardening, not evidence of additional executable XSS.
- Final parser matrix has 40 cases. Node 22.19.0 full mixed test run passes 54 files / 634 tests, including three runtime dependency-copy tests. ESLint and TypeScript checks pass. This is mixed regression, not strict-unit coverage.
- Two browser-export tests now build the same source with esbuild's browser conditions rather than relying on Vite-only `/src` URLs. They run in development and portable modes. This standalone fixture alone is not evidence of production application wiring.
- A third browser test saves a real HTML article through the application API and inspects the actual production Canvas, without injecting the standalone fixture: an entity-encoded javascript href is removed without clicking it, foreignObject Chinese remains, a normal local click/color animation renders blue, and reload retains filtering. All three passed against a real hidden portable EXE with private DATA and skipped env files.
- Node22.19 original Playwright discovery failed with html-encoding-sniffer `fallback/encoding.js` not in cache after the new DOM dependency. Explicit ESM preload of isomorphic-dompurify fixes discovery. Both E2E entry scripts retain their original modes/arguments with this preload. No global runtime or minimum version was changed.
- The original portable build completed, but the real EXE exited with missing jsdom `browser/default-stylesheet.css`. Therefore a successful package build alone was insufficient. The minimal fix externalizes isomorphic-dompurify and copies its runtime dependency closure, preserving nested versions and package resources. It does not replace the upstream package script wholesale.
- Dependency-copy tests cover incompatible nested versions, ancestor cycles, absent optional packages, and a resolution permission failure that must propagate. Only the dedicated missing-dependency error is skipped for optional dependencies.
- Actual copied runtime inspection found 76 package instances. All required peers resolved within the portable `app/node_modules`; absent peers were declared optional (`canvas` and `@noble/hashes`). This is evidence for this fixed lockfile, not a generic guarantee for arbitrary future dependency graphs.
- DOMPurify is distributed under its Apache-2.0 option of the upstream dual license. Original package license texts and the generated aggregate license notice are retained. The wrapper and jsdom are MIT licensed.
- Final Node22.19.0 development E2E: 46/46 passed in 3.0 minutes with `--update-snapshots=none`. The complete mixed run remains 54 files / 634 tests; lint and types both exit 0. The portable script rebuilt the production frontend successfully (existing large-chunk warning retained).
- Final portable build exits 0. The ZIP has 3,151 entries / 52,618,300 bytes; every entry passes CRC validation. ZIP SHA256: `ed5e3c29915bee003741126eedbcd6723d64a974619527d8a68fbd8c8bb6c8a9`.
- The rebuilt EXE passes all three browser checks, and the same ZIP extracted outside the repository passes those checks again (3/3, 3.0 seconds). Startup verifies API-reported PID/data directory and the private runtime record, then checks project API and built UI. Exit uses that same instance's quit API and verifies exit 0 plus runtime-record removal. All EXE launches use windowsHide, XIUMI_NO_BROWSER=1, XIUMI_NO_PAUSE=1, XIUMI_SKIP_ENV_FILES=1, a fresh private DATA directory and a prechecked private port. No deployed service, default browser, real credential, user DATA or global runtime setting was used.
- External Node22/24 CI remains pending. Local complete validation above is Node22.19; the earlier Node24 targeted parser run passed, but is not a claim of a final full Node24 matrix or of full packaged E2E. The portable browser check is the focused three-case matrix, not all 46 tests.

## Upstream contract sources

- https://github.com/cure53/DOMPurify/blob/3.4.17/README.md (server DOM support, hooks, clobbering defaults, post-sanitization caveat).
- Installed isomorphic-dompurify@3.0.0 package.json and shipped declarations (fixed package exports/engines).

Historical fork coverage percentages do not describe this upstream source tree. The new htmlGuard.ts belongs in its complete production denominator. These parser/compiler and browser tests are not a strict-unit coverage claim.
