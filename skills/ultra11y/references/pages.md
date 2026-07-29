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
  axtree.json   the accessibility tree as the browser computed it
  screen.png    full-page screenshot (pixel tier)
```

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

## Producing snapshots

## The per-page grid

RGAA is a **per-page** norm: an audit runs over a declared sample and each criterion gets a
status *on each page*. The engine's verdict is scope-wide. `pages` bridges the two.

```
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --json
```

One row per criterion (the pack's own under `--standard`), one column per page:
`C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess. The same grid is
embedded in `report` whenever pages are in scope. It rebuilds from a committed `audit.json`
**alone** — no snapshots on disk, no browser — because `scope.pages` records the pages and
every finding carries its `page`.

The per-page status is not computed a second time: a per-page *view* of the audit is fed to
the very same projection the report uses (`derivePackResults`). Grid and report therefore
agree by construction — out-of-scope criteria (RGAA 8.1), scoped-out siblings, pack overrides
and advisory handling all come from one implementation, not from a second one that drifts.

### Two honesty rules

**1. A finding is attributed to a page only when something says so.** In order: the snapshot
it was raised on, the scanned page URL, the `scan --sample` page name, then the page's own
recorded `sources`. Anything else stays **unattributed** and is reported as a count —
never spread across every page, which would invent non-conformities. A shared component
matches the first page deterministically rather than being duplicated onto each.

**2. "No finding here" means conforming only for a page whose real DOM was audited.** A page
with a snapshot earns `C` by silence, because the rules genuinely ran against its document. A
page assembled purely by source attribution (`basis: "attributed"` — e.g. a `scan --sample`
page with no snapshot) keeps its undecided criteria `manual`: absence of evidence is not
evidence of absence. The grid marks which is which, and warns when any page is source-only.

A non-normative recommendation never flips a page criterion to `NC`, exactly as in core.

## Producing snapshots

Anything that drives a browser can write one — the format is the contract, not the producer.
The engine ships a browser-side collector (`COLLECT_SNAPSHOT`) that returns the DOM, the
style digest and the boxes for the current page in a single `page.evaluate`; a producer
writes that alongside a `meta.json`. Snapshot producers wired into a project's E2E run and
its dev server are covered by their own references.

A malformed or unreadable snapshot is skipped, never fatal: one broken producer run must not
blind the whole report. A snapshot whose `meta.v` is newer than the engine understands is
**refused** rather than half-read.
