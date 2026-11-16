# Imported HTML theme and controlled layout plan

Approved direction: original full base 763d0dc; narrow port base c2161c0 (PR16), without image-collection or unrelated combination features, local deterministic transformations behind explicit proposal operations. Merely setTheme or changing colors is not structural rebuilding. Alternative arbitrary model HTML is rejected because it cannot preserve authored content; replacing the existing slots/selection implementation is also rejected because it loses upstream contracts.

1. Red tests through validateOp/store/aiContext for explicit theme/layout, stale complete HTML, independent text slots, long emoji text and retained images.
2. Add narrowly scoped theme/layout/HTML update helpers; theme catalog only, no arbitrary HTML. Preserve opaque islands and order, reject wholly opaque layouts; distinguish structure preservation from explicit color/font adaptation.
3. Keep existing selection policies, anchors, replay restrictions, slot colors and sanitization. Full HTML equality for theme/layout stale guard; existing text-slot merge unchanged.
4. Author Windows UI confirmation/rejection/undo/save/reload/export tests; no local browser execution. Focused tests and static checks, freeze for independent review, then serial full mixed/build by coordination.

New source files remain in the production denominator. Mixed DOM/store tests are not strict-unit coverage. No publication or real provider request.
