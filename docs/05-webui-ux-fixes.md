# Web UI editing reliability

## Scope

Addresses upstream [issue #3](https://github.com/123huangcan250/xiumi-ai-studio/issues/3) and dialog interaction defects found during code review.

- Plain-text paragraph fields preserve leading/trailing spaces and empty paragraphs when leaving a block or reopening a project. Import/AI text normalization keeps its original defaults.
- Imported HTML text slots preserve spaces and blank lines and expose left, center, right and justified alignment per text slot. Fixed SVG text slots deliberately do not expose CSS alignment, which would not reposition SVG text.
- The rich-text toolbar exposes four explicit alignment choices and their selected state. Whole-paragraph controls now replace old inline alignment without discarding bold/link/color marks.
- Exported rich-text indentation and repeated spaces use non-breaking spaces to prevent HTML collapsing them.
- Dialogs receive focus, cycle keyboard focus, and restore their trigger on dismissal. Escape closes only the top dialog. Article-level undo/delete/save shortcuts do not run behind an open dialog.

## Verification

Added unit regression coverage and Playwright workflows in `editing-ux` test files. Unit tests reproduce the failures before their corresponding changes. Run `pnpm check`, `pnpm build`, then `pnpm e2e` on a machine with local server sockets and Playwright browsers available. No screenshot baselines have been regenerated.

## Remaining limitations

This is a targeted reliability pass, not a visual redesign. It does not change authentication, production deployment or WeChat publishing permissions. Imported SVG text alignment still requires editing the source or changing its template. Browser and real WeChat rendering must be checked in a capable environment before merging.
