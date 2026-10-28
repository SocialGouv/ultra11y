# RGAA 4.1.2 — criterion-by-criterion review of the engine (issue #65)

What each of the 106 criteria can and cannot be trusted for, after a review of the pack against
the official tests, methodology and glossary (`src/data/standards/rgaa.json`). Every finding of
that review was **reproduced on a minimal page through the real engine before anything was
changed**; the ones that did not reproduce were dropped and are listed as such.

The ground truth lives in `tests/fixtures/rgaa-golden/`: a non-conforming page carrying a defect
for every criterion that can fail on one page (with a real image, a real video with speech and
on-screen text, a real audio file), its conforming twin, and for each the expected verdict of all
106 criteria. `tests/rgaa-golden.test.ts` audits both as a source file, as a capture and as a
recorded browser capture, and fails if the engine decides anything else, clears an expected NC,
says NA (even provisionally) where the truth is not NA, or hands the adjudicator a criterion that
is not NA with nothing to cite. Its list of known gaps is **empty**.
`tests/rgaa-exhaustive.test.ts` pins that every criterion has a tier per test, harvest subjects,
a golden row in both grids, and a recall seed for each decisive rule.

**Status legend.** `OK` — reviewed, nothing to change. `fixed` — a reproduced defect, corrected
with a test that failed first. `limit` — a known limit, kept on purpose or out of reach, with the
reason. A criterion can carry several.

## Cross-cutting fixes

| Mechanism | Before | After |
|---|---|---|
| Absence subjects narrower than the glossary | form fields = input/select/textarea; no button; lists = ul/ol/dl; tables = `<table>`; no `<input type=image>`; no `role=link`; office docs = pdf/doc/xls | ARIA field roles, contenteditable, output/progress/meter; a `buttons` subject; `role=list` and text drawn as a list; `role=table/grid/treegrid`; image buttons; `role=link`; odt/ods/odp/ppt(x)/rtf/csv/epub and any `download` link |
| NA justification | claimed to have searched for ARIA fields, list roles, image buttons… | says what was actually searched |
| Inherited NA over the criterion's own subject | only existence subjects could block it | presence-only subjects (`pointerActions`, `cryptic`) block it too |
| Rendering criteria with an empty harvest | 3.2, 3.3, 7.3, 8.2, 10.1, 10.4, 10.5, 10.9–10.12, 10.14, 12.8, 12.9, 12.11, 13.9, 13.11 — only NA or « undecidable » possible | stylesheets, declarations, viewport, tab order, markup to validate, instructions — and on a capture what the browser measured (probe ran / skipped, rendered rules that ran, axe verdict per criterion, computed colour pairs) |
| Agent NA on a criterion every page is subject to | accepted when the harvest was empty | refused for 8.1, 8.2, 8.3, 8.5, 10.1, 10.3, 10.4, 10.11, 10.12, 12.8, 13.9 |
| Code-construct predicates (12.10, 13.1, 13.8, 13.10–13.12) | read the page only; a shortcut in `app.js` proved « no shortcut » | a local `<script src>` is read; an unreadable one (CDN, capture bundle) leaves the criterion open |
| Heuristic subjects | read prose as code (an RGAA title in a table cell was « moving content ») | match only inside tags and `<script>`/`<style>` |
| Worklist size | absolute paths repeated in every `alsoAt` | paths relative to the working directory; citations still fold |

## Per criterion

| Criterion | Status | Notes |
|---|---|---|
| 1.1 | fixed | `<input type=image>` is harvested (was missing — an image-button-only page closed theme 1 NA); notes show title, aria-labelledby, aria-hidden, figure. limit: no rule yet for 1.1.4 (`ismap`) or 1.1.5 (`<svg>` alternative without `role=img`). |
| 1.2 | fixed | own subject `images` (was handed every ARIA attribute on the page). limit: `axe:image-redundant-alt` stays a candidate here although it is a pertinence signal. |
| 1.3 | OK | limit: no candidate rule for alternatives such as `alt="image"` or a file name. |
| 1.4 | limit | no CAPTCHA subject: inherits `images`, so a CAPTCHA served only in an iframe is not seen. |
| 1.5 | limit | same as 1.4. |
| 1.6 | OK | `aria-describedby`/`longdesc` now appear in the harvest. |
| 1.7 | OK | |
| 1.8 | OK | judgment on the image content. |
| 1.9 | fixed | own subject `images` with the figure context. limit: no static rule for a `<figure>` lacking `role`/`aria-label`. |
| 2.1 | OK | `iframe-title-missing` also accepts `aria-label`/`aria-labelledby`: an under-report only (2.1 is not concluded from silence). |
| 2.2 | OK | |
| 3.1 | OK | |
| 3.2 | fixed | evidence: computed text/background pairs with their ratio, stylesheet colour declarations, the rendered rules and axe verdict per page. |
| 3.3 | fixed | evidence: colour declarations, controls and buttons, `rendered:1.4.11`. |
| 4.1–4.6 | fixed | `temporalMedia` subject (video/audio/object/embed and player iframes, with their tracks) — a YouTube iframe was never shown. limit: no rule for 4.3.2 (`<track>` without `kind="captions"`). |
| 4.7 | fixed | wrong NA: inherited `images` from 1.1.1 and closed on a page with a video and no image. Own subject `temporalMedia`. |
| 4.8, 4.9 | OK | inherit `images`, which holds object/embed/svg/canvas. |
| 4.10 | limit | WCAG 1.4.2's applicability is `<audio>`/`<video>` only: `<bgsound>`, `<embed src=*.mp3>` and `new Audio()` are not seen. Provisional (judgment), so the agent still confirms. |
| 4.11, 4.12 | OK | |
| 4.13 | fixed | shown the media instead of the page's ARIA. |
| 5.1–5.6 | fixed | `tables` includes `role=table/grid/treegrid` (an ARIA-only data table closed theme 5 NA); notes give scope/id/headers counts and the table's name. limit: `table-caption-missing` stays a candidate on 5.4 (never decides). |
| 5.7 | fixed | as above. limit: `table-scope-invalid`/`headers-attr-dangling` do not skip layout tables. |
| 5.8 | fixed | as above. limit: `layout-table-data-markup` does not check `summary`, `<thead>`, `<tfoot>`, `role=rowheader/columnheader`. |
| 6.1 | fixed | label-in-name on a link is test 6.1.5 (`link-label-in-name-mismatch`, decisive); `role=link` harvested. limit: no candidate for generic link texts. |
| 6.2 | fixed | false NC: an `<svg role="img" aria-label>` inside a link was « no name » (decisive) — names now come from a self-naming descendant, per accname. Icon-only unnamed links are decisive. `role=link` closes no longer as NA. |
| 7.1 | fixed | a link's label-in-name no longer makes 7.1 NC; `invalid-aria-attr`, `invalid-aria-value`, `aria-required-attr`, `aria-prohibited-attr` and the axe `aria-*-name` checks now reach it as evidence. limit: `axe:button-name` on a form button still counts here (attribution only: the button fails 11.9 too); `aria-required-parent` reports under 1.3.1, which 7.1 does not map. |
| 7.2 | OK | |
| 7.3 | fixed | evidence includes pointer actions on native controls and listeners. limit: no rule for `onfocus="this.blur()"` (7.3.2). |
| 7.4 | fixed | `on-input-context-change` (a `<select>` that navigates) is routed as a candidate. |
| 7.5 | fixed | evidence: status-like containers anywhere and scripts writing into the page, plus the live-region probe. |
| 8.1 | fixed | a source file with no doctype is harvested; NA refused. |
| 8.2 | fixed | false NC: an id reused across `v-if`/`v-else` arms. `invalid-aria-attr`/`invalid-aria-value` decide 8.2.1. Evidence: the document to validate with its doctype, duplicate ids, interactive nesting. NA refused. limit: no full W3C Nu validation offline. |
| 8.3 | fixed | C by silence over `xml:lang` alone on HTML5: the methodology accepts it only for XHTML 1.1 (ACT b5c3f8 agrees — now consistent, 169/187). limit: a SPA whose `lang` is set at runtime reads as missing in source. |
| 8.4 | OK | dropped: « `lang="zz"` passes » does not reproduce (registry check). |
| 8.5 | fixed | (#67) an `<svg><title>` counted as the page title. |
| 8.6 | OK | limit: no candidate for default titles (« React App »). |
| 8.7 | OK | |
| 8.8 | limit | `lang-invalid` stays a candidate here; `x-klingon`-style private-use tags are accepted. |
| 8.9 | OK | |
| 8.10 | OK | dropped: `dir={x}` in JSX does not produce a false NC. limit: no detector for RTL text without `dir`. |
| 9.1 | fixed | `role=heading` is harvested. limit: text styled as a heading is not harvested. |
| 9.2 | OK | |
| 9.3 | fixed | wrong NA: no `<ul>` was « no list » — `role=list` and lists drawn with bullets/`<br>` are harvested, and 9.3 is flagged judgment (« regroupées visuellement »). False NC: a `<transition-group>`/`<ng-container>` inside a list. `dl-structure` routed as a candidate. |
| 9.4 | fixed | shown quotations (`<q>`, `<blockquote>`, quoted text) instead of the outline. |
| 10.1 | fixed | false NC on `<link rel=mask-icon color>`; (#67) « Il y a à faire » read as spaced letters. Evidence: the stylesheets. NA refused. |
| 10.2 | OK | |
| 10.3 | OK | NA refused. |
| 10.4 | fixed | evidence: viewport, fixed heights/overflow, px font sizes, the zoom probe. NA refused. |
| 10.5 | fixed | evidence: colour declarations (was inline styles only). |
| 10.6 | fixed | `axe:link-in-text-block` routed as a candidate. |
| 10.7 | fixed | false NC: `main:focus{outline:none}` on a skip-link target Tab never reaches; the live probe missed indicators on the wrapper (`:focus-within`) and the next sibling (`input:focus + label`). Evidence: focus rules. |
| 10.8 | OK | |
| 10.9, 10.10 | fixed | evidence: the page's instructions, not only the ones already using a sensory word. |
| 10.11 | fixed | evidence: viewport, widths over 320px, `nowrap`, `pre`/tables, the reflow probe (was `readingOrder`). NA refused. |
| 10.12 | fixed | evidence: spacing declarations, fixed heights, the text-spacing probe. NA refused. |
| 10.13 | fixed | its own subject `additionalContent` had been lost; the hover probe is shown. |
| 10.14 | fixed | the hover probe is shown. limit: no rule for a `:hover` reveal without a `:focus` twin. |
| 11.1–11.4 | fixed | wrong NA: a form of ARIA widgets was « no field ». `axe:aria-input-field-name`/`aria-toggle-field-name` decide 11.1.1. |
| 11.5 | fixed | false NC: one checkbox per table row (`name="ids[]"`) is a per-row choice, not an ungrouped question. |
| 11.6 | fixed | false NC: a fieldset around one field. `axe:fieldset` removed (no such axe rule — inert). |
| 11.7 | OK | |
| 11.8 | OK | dropped: `<optgroup {...spread}>` does not produce a false NC. |
| 11.9 | fixed | wrong NA: a form with only buttons was « no field »; a `buttons` subject now. |
| 11.10–11.12 | fixed | as 11.1 (ARIA fields). |
| 11.13 | OK | |
| 12.1–12.4 | fixed | noise: the brand link to `index.html` was presented as the site map. |
| 12.5 | fixed | shown the search engine (`navMechanisms`). |
| 12.6, 12.7 | OK | limit: `skip-link-target-missing` stays a candidate. |
| 12.8 | fixed | evidence: the DOM tab order (was tabindex only). NA refused. |
| 12.9 | fixed | the keyboard-trap probe is shown. |
| 12.10 | fixed | a shortcut in a local script is read; `accesskey` harvested. |
| 12.11 | fixed | the hover probe is shown. |
| 13.1 | fixed | timers in a local script are read. |
| 13.2 | limit | `window.open` in an external script is not part of `newWindow`, which can still close 13.2 by absence. |
| 13.3, 13.4 | fixed | wrong NA over `.odt`/`.pptx`/download links. |
| 13.5, 13.6 | fixed | wrong NA: inherited `images`; a `cryptic` subject (emoji, emoticons, kaomoji, ASCII art). |
| 13.7 | fixed | noise: prose about flashes was « a flash mechanism ». |
| 13.8 | fixed | noise as above; animated GIFs are harvested. |
| 13.9 | fixed | evidence: orientation media queries, `screen.orientation.lock`, the viewport (was `readingOrder`). NA refused. |
| 13.10, 13.12 | fixed | gesture and device-motion listeners are harvested; local scripts read. |
| 13.11 | fixed | wrong provisional NA: WCAG 2.5.2's « no down-event handler » is not « no pointer action ». |

## Review findings that did not reproduce

- `dir={x}` in JSX and `<optgroup {...spread}>` do not produce false NCs on 8.10/11.8.
- `lang="zz"` is rejected (8.4).
- « Tests labelled static make a wrong NA final » holds only where the absence itself is unsound:
  tiers are derived from decisive rules, so the fix is in the subjects (and 9.3's judgment flag),
  not in relabelling tiers.
