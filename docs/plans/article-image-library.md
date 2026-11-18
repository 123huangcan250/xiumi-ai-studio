# Article image collection: approved compatibility plan

Base 041cdb4. Implement only the previously requested local natural-language image-library command. Preview current validated AI scope, confirm before writes, sequential progress/partial errors, explicit in-flight close semantics, no document mutations or LLM URL transmission. Preserve safeFetch host/IP/redirect/budget checks and upstream bestFrame/Sharp/index transactions.

1. Test and implement intent plus readonly validated selection collector (native images, nested HTML/SVG references/backgrounds, replay image references; no rendering/glyph generation).
2. Test and implement dedicated bounded importer. Reuse saveAsset; add optional hashed source identity only, preserving existing callers. Distinguish indexed local assets and managed glyphs. Reject arbitrary local URLs/files; normalize remote URL while retaining query; per-source serialization/idempotency and bounded requests.
3. Test and implement snapshot confirmation UI plus current scope epoch guard; stale-before-confirm rejects. Close stops remaining items but current request may finish; retry skips known successes. Wire local command before aiEdit, not a model tool.
4. Real local HTTP and React integration; author Windows browser cases (no local browser). Full mixed/lint/types/build/discovery; independent review before parent publication.

No changes to replay rendering, crop/exchange, compiler/export, image-budget policy or network allowlist. New modules remain in the full production denominator; no strict-unit coverage claim.
