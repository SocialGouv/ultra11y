# Page snapshots — auditing a real page, offline

A **capture** (`render --setup`) is a rendered *component*. A **snapshot** is a rendered
*page*: the whole document as the browser built it, plus the signals only a browser has
(computed styles, boxes, accessibility tree, a screenshot), stored on disk so the static
engine can re-audit it later with **no browser**.

That difference is not cosmetic. It is what makes a whole class of criteria decidable.

```
.ultra11y/pages/<page-id>/
  meta.json     page identity: id, name, url, route?, auth?, viewport?, sources?
  dom.html      documentElement.outerHTML, prefixed with the usual capture comment
  styles.json   computed-style digest, joined to the DOM by document-order index
  boxes.json    bounding boxes, same join key
  css.json      the page's own stylesheets (rules + declarations), NOT element-indexed
  axtree.json   the accessibility tree, when a producer supplies it (no rule reads it yet)
  probes.json   what the LIVE probes measured here — and `probed`, which ones actually ran
  axe.json      the axe pass that ran beside them (`ran: true` is what makes its silence usable)
  screen.png    viewport screenshot (pixel tier)
```

The last two are the measurement half, and they are what lets a page CONCLUDE rather than
merely report. `renderedProvesOn` reads `pageCoverage.scs` / `.axe`, both derived from them, so
a page with no `probes.json` can raise a rendering non-conformity and can never earn a
rendering conformity — 1.4.4, 1.4.10 and 1.4.12 have no offline rule at all, and 1.4.3's
canonical decider is axe. `probed` is written only for a probe that really ran: one that threw,
a viewport that would not resize, an override that would not apply — none of them reach it,
because their silence is not a measurement.

`audit` ingests `.ultra11y/pages` automatically, exactly as it ingests `.ultra11y/captures`
(`--no-captures` opts out of both). Nothing new to run:

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --jsx     # snapshots folded in automatically
```

## Why a snapshot decides more than a capture

A component capture is a **fragment**: no `<html>`, no `<head>`. The engine's `scope: "page"`
rules are deliberately skipped on fragments (`isFullDocument`), because a `<button>` has no
business declaring a page language. A snapshot **is** a full document, so those rules run:

| Rule | WCAG | RGAA |
|---|---|---|
| `html-lang-missing` | 3.1.1 | **8.3** |
| `title-missing-empty` | 2.4.2 | **8.5 / 8.6** |
| `missing-main-landmark` | 1.3.1 | 12.6 |

None of these can be judged from a component render, and several cannot be judged from source
either once a framework injects the document shell. The snapshot is where they become real.

> Do **not** "fix" this by making the unit-test harvester serialize `documentElement`. In
> jsdom a component test still has an `<html>` with no `lang` and no `<title>`, so every
> component capture would report two blocking non-conformities that describe nothing a user
> could experience. Component captures stay fragments, on purpose.

## Page identity

`dom.html` carries the ordinary provenance comment, with two extra fields:

```html
<!-- ultra11y:capture v="1" source="app/page.tsx" page="accueil" url="https://example.com/" -->
```

Every finding raised on it is stamped with `page` (the stable id) **and** `origin.sourceFile`
(the source that rendered it). That pair is what the per-page criterion grid joins on, and
what lets a finding found *at render time* be reported *against the code that caused it*.

Ids are slugified from the URL path (accent-folded, lowercased): `/nous-contacter` →
`nous-contacter`, `/` → `accueil`. A producer may pass an explicit id instead. An id must
match `[a-z0-9][a-z0-9-]*` — it becomes a directory name, so it cannot be allowed to traverse.

## The join key, and why it is verified

`styles.json`, `boxes.json` and `axtree.json` index elements by **document-order ordinal**,
not by CSS selector — a selector would have to survive serialization and re-parsing, an
ordinal does not. Each entry repeats its `tag`, and the join (`alignedStyles`) checks every
one against the re-parsed DOM.

**On any mismatch the entire digest is refused**, not just the offending entry. A silently
shifted index would attribute one element's colour to another and manufacture a
non-conformity out of nothing — the exact failure mode this tool exists to prevent. A refused
digest simply leaves the rendering criteria `manual`, which is the honest outcome.

The collector is bounded (`COLLECT_MAX_ELEMENTS`); when it truncates, `truncated: true` is
recorded so the tail reads as *unmeasured*, never as *clean*.

## The rendered tier — criteria only a browser can answer, decided offline

A snapshot carries what a browser knows and source does not. Six rules read it, and they
run inside the ordinary `audit` — **no browser, no Docker, no running server**, from a
committed artefact. That is the point: CI decides these without booting the app.

| Rule | WCAG | RGAA | Reads |
|---|---|---|---|
| `rendered-contrast` | 1.4.3 | **3.2 / 10.5** | computed `color` vs the nearest opaque ancestor background |
| `rendered-contrast-pixel` | 1.4.3 | **3.2 / 10.5** | the screenshot, where the CSSOM cannot answer |
| `rendered-link-colour-only` | 1.4.1 | **10.6** | computed styles of a link inside running text |
| `rendered-nontext-contrast` | 1.4.11 | **3.3** | a control's computed fill and its four borders |
| `rendered-focus-not-visible` | 2.4.7 | **10.7** | the stylesheet's `:focus` rules |
| `rendered-orientation-lock` | 1.3.4 | **13.9** | `@media (orientation:…)` rules |

**`rendered-contrast` beats the inline-literal rule** it sits beside: `contrast-literal` can
only judge colours written inline in the markup, so it says nothing about a real stylesheet.
The computed value is the value the user sees, and large-text thresholds need no unit guessing
because the browser already resolved everything to px.

**`rendered-contrast-pixel` exists for one case**: text over a gradient, a background image or
a translucent stack. There, `background-color` is `rgba(0,0,0,0)` and no style analysis will
recover the real backdrop — a documented blind spot of every CSSOM-based check, axe-core
included. The screenshot is the only place the answer exists. It is deliberately narrow: it
runs **only** where `rendered-contrast` declined, so one defect is never counted twice, and it
reports only when the measured region has one dominant colour. Contrast against a photograph
is not a single number, and pretending it is would be a fabricated finding.

**`rendered-link-colour-only` makes RGAA 10.6 decidable at all** — it had no rule before. A
coloured link with `text-decoration: none` in a paragraph is invisible to source analysis (the
rule lives in a stylesheet) and to axe-core. It is scoped to links *with text* *inside a text
block*, which is where the criterion applies; a nav or button-styled link is out of scope by
construction, and an underline, a bottom border, a background or a distinctly heavier weight
all clear it.

**`rendered-nontext-contrast` gives RGAA 3.3 its first rule.** A control is distinguishable
when its fill contrasts with the surroundings, **or** when a drawn border contrasts with either
side of itself — three independent ways to pass, deliberately generous. What remains is the
unambiguous failure: a borderless field the same colour as the page. It declines outright when
a `box-shadow` or a visible `outline` might be drawing the boundary instead.

**Two criteria are properties of the STYLESHEET, not of any element's computed style**, and
`css.json` is the only place they exist. `rendered-focus-not-visible` catches the classic
`*:focus { outline: none }` reset — reported **only** when no `:focus` rule anywhere in the
document restores an affordance, so a targeted reset that a sibling rule replaces is never
flagged. `rendered-orientation-lock` catches a media query that turns the whole document a
quarter turn; a decorative element rotated in landscape is legitimate and is not flagged.

Both **decline when `unreadable > 0`** — a cross-origin stylesheet the browser would not let us
read. Silence there means *"I could not look"*, not *"nothing there"*, and the difference is
the whole point.

RGAA 10.7 was already reachable through the live `scan` probe (`dyn-focus-visible`), which
needs a browser and a running app. The CSSOM route decides it **offline**.

### What makes this tier trustworthy

It can say "non-conforming" because it can also say **"I don't know"**. Each of these leaves
the criterion undecided rather than guessing:

- no ancestor declares an opaque background, or the backdrop is an image → no CSSOM verdict;
- the screenshot region is genuinely varied → no pixel verdict;
- a stylesheet was cross-origin and unreadable → no stylesheet verdict;
- a `box-shadow` or `outline` might be the boundary → no boundary verdict;
- the element sits past the collector's cap (`truncated: true`) → no signals, no verdict;
- the style digest does not verify against the DOM → the **whole** digest is refused.

And without `doc.signals` — every ordinary source file — the rules do not fire at all, so
adding this tier cannot change a single pre-existing verdict.

### How much of RGAA the engine can evidence

`tests/rgaa-coverage.test.ts` pins the number and ratchets it: **51 of 106** criteria map onto
an engine rule, up from 43 before this tier — the rendered rules plus two declarative pack
rules (`optgroup` without `label`, an invalid `dir` value). It can only go up — a refactor that silently
unmaps a criterion fails CI rather than quietly shrinking the audit. Criteria nothing can
decide stay at zero *visibly*: RGAA 8.1 maps only to the removed WCAG 4.1.1, and 13.3 depends
on downloadable office documents.

## The per-page grid

RGAA is a **per-page** norm: an audit runs over a declared sample and each criterion gets a
status *on each page*. The engine's verdict is scope-wide. `pages` bridges the two.

```
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --json
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --json --out audits
#   → also writes audits/pages.json — the same projection, for a machine
```

`--json --out <dir>` writes `<dir>/pages.json` beside the sheets it mirrors. The grid, the
dossiers and the HTML are documents for a person; this is the one file a later job, a badge or
a dashboard can read without re-deriving anything, and stdout alone cannot serve them — in CI
the caller is a composite action step, and a criterion × page matrix does not fit in an action
output. Its shape is `{ pages: [{ id, name, url, basis, criteria: [{ id, status, decidedBy }],
conformancePct, decided, total }], unattributed }`.

One row per criterion (the pack's own under `--standard`), one column per page:
`C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess. The same grid is
embedded in `report` whenever pages are in scope.

A column is headed by the page's **URL**, not its name. A name is not an address — two routes
of one app are routinely both called « Accueil », and a `<title>` is written for a browser tab
rather than for a column. When every page in scope shares an origin (what a crawl of one site
produces) the header is the **path** and the origin is stated once above the table, because
nine columns of `https://example.fr/mentions-legales.html` is a table nobody reads; a
mixed-origin run keeps full URLs, since there the origin *is* part of the identity. It rebuilds from a committed `audit.json`
**alone** — no snapshots on disk, no browser — because `scope.pages` records the pages and
every finding carries its `page`.

The per-page status is not computed a second time: a per-page *view* of the audit is fed to
the very same projection the report uses (`derivePackResults`). Grid and report therefore
agree by construction — out-of-scope criteria (RGAA 8.1), scoped-out siblings, pack overrides
and advisory handling all come from one implementation, not from a second one that drifts.

## The per-page REPORT (`pages --format report`)

The grid answers *"which criteria fail, across the pages?"* — the right shape for a diff, the
wrong one for a page owner: with 106 RGAA criteria over N pages nobody reads a column. The
report answers *"what is the state of THIS page?"*.

```
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --format report --out audits
#   → audits/pages-<date>.md — the index, then one section per page

node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --format report --split page --out audits/pages
#   → audits/pages/index.md + audits/pages/page-<id>.md      (recommended past 3–4 pages)
```

Each page's sheet carries, in order: its identity (name, URL, auth badge, snapshot/source
basis), **its screenshot**, its rate and C/NC/NA/to-assess tally, **every criterion of the
active standard** with its status on that page, then each non-conformity as the ordinary
**auditor conformance block**.

Two things it deliberately does NOT do:

- **It re-decides nothing.** Every status comes from `derivePages` and, under a pack, from
  `derivePackResults(pageView(…))` — the very projection the grid and the report already use.
  A second implementation would drift, and the first symptom of drift in an accessibility
  report is a criterion silently declared conforming.
- **It invents no format.** The non-conformities are rendered by `renderAuditorUnit`, so a
  page sheet, the compliance report, the PRD and the GitHub issue are the same block — and
  the occurrence lines stay parseable by `verify`.

The screenshot is **copied next to the report** when you pass `--out`: each page's
`.ultra11y/pages/<id>/screen.png` lands in `<out>/assets/<id>.png` and is linked relatively
from there. That is what makes the output directory self-contained — CI uploads `audits/`
alone as the artefact, and a `../../.ultra11y/…` reference would be a broken image in every
sheet the reviewer opens. Without `--out` (streaming to stdout) the path stays relative,
since there is no directory to keep intact. A page with no screenshot says so, rather than
showing nothing.

Sheets are named `page-<id>.md`: a page whose id is `index` — the ordinary id for an
`index.html` target — would otherwise be written over the index itself.

`check` recognizes these files (they carry an `ultra11y:pages-report` marker) and runs the
gates that mean something here — above all **no invented criterion** — instead of demanding
the §1–5 structure of a conformance document.

### Four honesty rules

**0. A page is recorded only if the browser stayed on it, and answered.** A sample page's
declared `id` and `name` are the identity the report speaks, and they are applied to whatever was
on screen. So a route that redirects — an expired session bouncing to sign-in, a wizard step the
application state does not open — would be filed under the requested page's name while showing
something else: a sheet, a screenshot and a rate that describe a different screen, with nothing
about the document looking wrong.

`scan --sample` refuses two ways:

- **It moved.** The address is compared as the app routes: the **path** always; the **fragment**
  and the **query** when the request carried one, because a hash-router app puts the route there
  and `#/admin` → `#/login` is exactly the bounce this rule exists for; the **host**, since a
  same-path landing on an IdP is the same misattribution (a scheme, a port or a `www.` differ
  freely — that is canonicalisation). The comparison uses the URL captured right after the
  navigation settles, before any probe could click something that routes.
- **It answered an error.** A framework's own not-found page is a complete, valid document
  served at the address you asked for — `notFound()` in Next is exactly that — so no address
  comparison can see it. The HTTP status can: anything ≥ 400 is refused.

A refused page is **named in the report**, with what was asked, what was reached and why, and it
is removed from `scope.sample` — leaving it there would put it back in the grid with the same
basis as a page really visited, so the deliverable would claim we looked at it. A run where
*every* page was refused exits non-zero: that is not a partial result, it is a scan that measured
nothing. A page reported missing is a bug in the sample or in the state you seeded, and both are
fixable; a page reported under the wrong name is a false conformance claim.

**1. A finding is attributed to a page only when something says so.** In order: the snapshot
path it was raised on (`.ultra11y/pages/<id>/dom.html` — the id is *in the path*, which is what
lets `pages` repair an audit produced before the stamp worked, with no `dom.html` left on disk),
the scanned page URL, the `scan --sample` page name, then the page's own recorded `sources`.
Anything else stays **unattributed** and is reported as a count — never spread across every
page, which would invent non-conformities. A shared component matches the first page
deterministically rather than being duplicated onto each. The count spans both channels: a pack
finding no page claims is counted too.

**2. "No finding here" means conforming only for a page whose real DOM was audited.** Three
bases, and only the first earns `C` by silence:

| `basis` | What it means | Silence means |
|---|---|---|
| `snapshot` | this audit read the page's serialized DOM | conforming, for the `static` criteria |
| `attributed` | no snapshot — only source findings were mapped onto it | nothing; the criteria stay `manual` |
| `not-audited` | a snapshot exists, but **this** audit never read it | nothing; the criteria stay `manual` |

For the last two, **absence of evidence is not evidence of absence**: no rule ran against that
page's document, so its undecided criteria stay `manual` rather than earning a verdict by
silence. The grid marks which is which, and warns when any page is not a snapshot.

`not-audited` is a separate word on purpose. A source-only `audit` records every snapshot
directory on disk as a page in scope while reading none of them, and calling those pages
"source" would tell the reader they have no snapshot — a different false statement, not a
smaller one. The evidence is `scope.pagesAudited`, written beside `scope.pages` on every audit
(as `[]` when none: a guard that is absent whenever there is nothing to report is a guard that
switches itself off exactly when it matters). An audit written before that field existed leaves
it undefined, is read as "unknown", and keeps its recorded basis.

**A rate over nothing is not a rate.** The per-page rate is `C ÷ (C + NC)` over the criteria
that page actually decided, and it is **null** when that denominator is empty — rendered `—`,
never a number, and always beside its denominator: `50 % (2/106)`, `— (0/106)`. Returning 100
there is how thirty-eight sheets reported a perfect page for an app a human auditor had just
found sixteen non-conformities in: the criteria were all « à évaluer », so nothing was decided,
so the rate was 100. The index cell carries the same `(decided/total)` bracket as the sheet's
« Couverture » line, from one shared computation, so the artefact people paste into a pull
request can no longer say something its own sheet contradicts.

**3. Silence only decides what the engine CAN decide.** A scope-wide `NC` on a judgment
criterion means one definite failure fired *somewhere* — not that the engine can rule on that
criterion. On a page where the failure did not fire, the engine knows "no definite failure
here", which is not "conforming": alt relevance, link purpose and reading order are still
nobody's verdict. So only criteria whose test-level matrix opts into `completeBySilence` earn
`C` from a fully measured silent run — under RGAA that is **8.5 and 10.1, and
those two only**. A rule that covers one sub-test, one precondition or one allowed mechanism
cannot close the rest of the criterion. Everything else stays « à évaluer » until `scan`, the
snapshot tier or an adjudication decides it. Before this rule a page with no images scored 100%
on « chaque image a-t-elle une alternative pertinente ? », a rate computed over criteria nobody
had assessed.

What a criterion CAN be decided as, without any of that, is a separate question: since the
engine learned to prove applicability (`src/audit.ts` `SUBJECT_MATTER`), a criterion whose
subject matter is absent from the whole scope closes as a justified `NA` — so a repository with
no media reports RGAA theme 4 as not applicable rather than as « à évaluer ».

A non-normative recommendation never flips a page criterion to `NC`, exactly as in core.

### Repeated occurrences, folded

Per-page attribution surfaces design-system defects at their true multiplicity: one DSFR
link-styling rule can be 472 findings over 38 pages from 7 distinct selectors. A page sheet
therefore groups occurrences by `(file, ruleId, selectorHint)` under a counted header —
`` **`a.fr-link`** — lien identifié par la couleur seule · ×12 ``.

It is a **display** fold. The header is deliberately not checkbox-shaped, every occurrence keeps
its own parseable line indented beneath it, and the block still announces the raw count — so
`verify` builds exactly as many items grouped as ungrouped and no claimed non-conformity escapes
adjudication by being tucked under a heading. `ruleId` is in the key because WCAG 1.4.3 carries
both a CSSOM measurement and a screenshot measurement, and presenting those as one defect would
be a lie. It is off everywhere else: the backlog, `prd --split criterion` and every tracker issue
body are byte-identical to what they were.

### Showing the defect, not only citing it (`--evidence`)

`selectorHint` is lossy by construction — first class only, `href` truncated — and every
rendered-tier finding on a client-rendered page is anchored at `dom.html:2`, the `<html>`
element. What a non-technical reviewer receives is `` `.ultra11y/pages/accueil/dom.html:412`
(`div.card`) ``, which locates nothing.

```sh
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --format report \
  --split page --evidence --out audits/pages
```

Each occurrence gains an inert sub-bullet with an annotated crop of the offending element,
written to `assets/<page-id>/<hash>.png`:

```md
- [ ] `.ultra11y/pages/accueil/dom.html:412` (`div.card`) — <img> without an alt attribute…
  - ![Cropped capture of the img element on the accueil page, outlined](./assets/accueil/c90959b13aa2.png)
```

**Derived at render time, never stamped on the finding.** A rectangle in pixels is a property
of the image: a box written onto a `Finding` becomes silently wrong the moment the audit is
re-rendered against another capture. The join goes `sourceStart` → document-order ordinal →
`boxes.json`, through the same `alignedBoxes` the rendered tier uses — including its refusal
to align a digest whose tags disagree. `Finding` gains no field.

The mark is not monochrome: a white halo, a red ring, corner brackets whose shape says "here",
and a dashed inner line that survives a monochrome print. This tool reports 1.4.1 failures; its
own deliverable cannot commit one.

**Nothing is cut in silence.** Thirteen refusal reasons, each with its own sentence, counted
per page and per criterion in the sheet itself:

| Reason | What happened |
|---|---|
| `no-snapshot` | the capture this finding's own path names is not on this disk |
| `no-screenshot` | the producer captured no image for that page |
| `unreadable-image` · `no-boxes` · `truncated` | the capture or the box digest cannot be trusted |
| `no-offsets` · `unjoinable` | the finding has no byte range, or it resolves to no element |
| `page-scope` | the finding is about the document, not an element you can frame |
| `zero-area` · `below-the-fold` | the element is invisible, or outside a viewport-only capture |
| `unknown-scale` | the device pixel ratio could not be derived — a crop would be off-target |
| `deduplicated` | the same defect on the same element — another occurrence's picture shows it |
| `capped` | a **distinct** defect went undrawn: 6 per rule, 12 per page, `--evidence-max` per run |

The last two are counted apart on purpose. `deduplicated` costs the reader nothing — the
defect is on screen, under another occurrence. `capped` is a real gap, and it is the only one
a setting can close.

A finding raised on SOURCE is in neither column: it never had pixels, so it is not an
occurrence that failed to be illustrated, and a repository audited from source alone gets no
notice at all rather than one line per finding.

An occurrence with no picture must never read as an occurrence with no defect, so the sheet
says how many were not illustrated and why. So does the combined document, the HTML sheets and
the composite — every surface that can show a crop can say what it did not show.

Without `--evidence` the Markdown is **byte-identical** to what it was. The crop bullet carries
no `[ ]`, so `verify` builds the same worklist with or without it — indentation alone would not
be enough, since `AUDITOR_OCCURRENCE` is anchored `^\s*-\s\[ \]` and tolerates leading space.

### The same, as a page (`--html`)

`--html` writes `index.html` and one `page-<id>.html` beside the Markdown they mirror.
Self-contained: no script, no external asset, nothing pointing outside the output directory.

**The printable single file comes from `report --html`, not from here.** One composite per
artifact: emitting one from both commands would put a second copy of every inlined crop into
the same upload, so `pages --html` deliberately writes none.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json --html --evidence --out audits
```

See `references/ci.md` for the artifact layout and the inline-size budget.

## Holding an external audit against the grid

A human auditor's verdict is evidence, not a measurement this engine can redo. `import` reads one
into a tool-neutral (page, criterion, status) model, and `pages --diff` compares it with the grid.

```
node scripts/ultra11y.mjs import --from file audit-rgaa.json --out audits
node scripts/ultra11y.mjs import --from ara <report-id> --out audits    # writes the raw response too
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --diff audits/external-latest.json
```

A file is the primary route and the network a convenience: the engine is install-free and
keyless, so a reproducible audit must not depend on a third party being up. `--from ara` writes
the raw response to disk **before** parsing it, so what was imported is committable.

The adapter refuses rather than guesses — an unrecognised status token, a criterion the pack does
not define, a result naming an undeclared page are each reported, and nothing is written on a
partial parse, because a partial import looks complete.

The diff sorts each (page, criterion) pair into five buckets: **corrigé · inchangé ·
partiellement corrigé · régressé · non retesté**. The last one is the one no report surfaces: a
criterion that was non-conforming and was left untested in the counter-audit is neither confirmed
fixed nor confirmed broken. Nothing is re-decided — both sides arrive decided — an undecided
criterion is never read as agreement, and a page only one side ruled on is reported as a coverage
gap, which is the check that says *"10.11 is NC on the funnel and your grid has nothing there"*
on day one rather than after a ticket is filed against the wrong page.

An imported audit is never merged into the engine's verdict and never written into
`packAdjudication`. `src/external/` is a leaf.

## Producing snapshots

Anything that drives a browser can write one — the format is the contract, not the producer.
The engine ships a browser-side collector (`COLLECT_SNAPSHOT`) that returns the DOM, the
style digest and the boxes for the current page in a single `page.evaluate`; a producer
writes that alongside a `meta.json`.

Three producers ship with the engine, and they all evaluate that one collector:

| Producer | When it runs | Notes |
|---|---|---|
| `scan` | a URL, a sitemap, a crawl, or the declared sample | on by default (`--no-snapshot` opts out); collected on the **pristine** page, before axe and before any probe |
| `render --e2e` fixtures | inside your Playwright/Cypress run | the page in the state your test built (logged in, modal open) |
| `dev` side-car | as you browse in development | the overlay detaches itself before collecting |

`scan` is the one that makes a **served site** auditable page by page: without a snapshot a
scanned URL is `basis: "attributed"` and, by honesty rule 2 below, can never earn a
conforming verdict. With one, the page-scoped rules run, the runtime-injected DOM is
audited, and the page re-audits offline. `scan --merge` audits the snapshots it just wrote
and folds them in, so the grid is populated in the same run.

A malformed or unreadable snapshot is skipped, never fatal: one broken producer run must not
blind the whole report. A snapshot whose `meta.v` is newer than the engine understands is
**refused** rather than half-read.
