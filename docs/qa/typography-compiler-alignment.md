# Document typography compiler alignment, stage 1

> Historical development record: the combined-base counts below are not this narrow branch’s results. This branch replays only the typography changes onto upstream `f0c819f`; see `rich-typography-narrow.md` for its scope and fresh verification.
Base: combined upstream PR7–10 `1284931`; reference: fork `9d7493487713ec1a07dea313062ccbe67e6e3fb4`. This stage is compiler support only. It does not deliver user-visible Word-style controls; RichEditor and HTML selection controls remain later work. No package/lock or application UI changes.

## Supported data

Rich-text JSON `textStyle` marks may contain `fontFamily` and/or `fontSize`, alongside existing color. Output is an inline span with validated style values. Existing bold/italic/underline semantics and explicit-color priority are untouched. Invalid typography is omitted without discarding valid color/text. Existing replay compiler, HTML sanitization, SVG/slot color editing, deliberate whitespace preservation and server filter/strict policy are unchanged.

`safeTextFont` is a bounded syntax allowlist, not an installed-font catalogue: at most 180 characters, comma-separated nonempty family names, Unicode letters/numbers, spaces and hyphens, optionally paired single/double quotes around a name. Unquoted names start with a letter or hyphen. Empty entries, unmatched quotes, line/tab controls, escapes, CSS functions, declarations and markup are rejected. This intentionally supports system/custom family names, but cannot guarantee availability on the receiving device. Existing CSS serialization safely handles quoted names. Unlike the fork reference's broad character regex, malformed comma/quote-only strings do not pass.

`safeTextSize` accepts only decimal px values between 8 and 96 inclusive, bounded to 20 input characters and normalized numerically. UI constants retain the existing seven font choices and common 12–48px sizes for later controls. Fonts are not embedded in exported HTML; fallback depends on the destination.

## Tests and limits

- First 39 cases: 9 failed / 30 passed against absent implementation, then all passed after implementation.
- Combined new tests plus existing textColor/replay suites: 90 passed at that stage.
- Two additional single-attribute/quoted-family DOM cases verify font-only and size-only marks work without color and cannot add HTML attributes.
- Tests cover B/I/U + explicit color, adjacent text and spacing, unsafe CSS/size rejection, rich output unchanged when typography is absent, and original replay renderer output.
- One new `src/core` production module must be included in future complete-source coverage; no coverage percentage is claimed here.
- Browser editing, undo, save/reload from new controls, mobile layouts and actual glyph/font loading are NOT tested by this compiler-only stage. No desktop uncommitted work was recovered.

Final Linux verification: TypeScript and changed-file ESLint passed. Complete configured mixed suite passed 85 files, 886 tests, with 2 Windows-only case-alias tests skipped (888 total). This is not a strict-unit coverage measurement. Git whitespace check passed. No UI/browser/package tests were run for this stage.
