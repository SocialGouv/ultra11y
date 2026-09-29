# Methodology & report format

## Per-criterion statuses

- **C** — conforming (every applicable test passes).
- **NC** — non-conforming (at least one test fails; a finding cites `file:line`).
- **NA** — not applicable (no element in scope is concerned — justified).
- **To assess (manual)** — a criterion the engine cannot decide on its own: the AI agent
  adjudicates the *judgment* ones itself (`verify --manual`, gated); the *rendering* ones are
  decided by the `scan` tier. Only the still-undecidable residue stays listed here.

## Pass rate

Conformance rate = **conforming criteria ÷ applicable criteria × 100**.

The engine only computes the **automatic static-check pass rate**, over the small
machine-decidable subset it can actually decide: `C ÷ (C + NC)`. Because WCAG success
criteria are coarser than the engine's rules, that denominator is deliberately small —
it is **not** a full conformance rate. Full WCAG 2.2 AA conformance requires completing
the "to assess" criteria by hand.

That rate remains available in the complete artifact, beside its qualification. GitHub job
summaries and PR comments do **not** print it: they print `decided/total`, the provenance
breakdown (`engine`, `scan`, `agent`) and the remaining count. This prevents a static result
such as 11 conformities and 1 non-conformity from being read as “92% RGAA” when only 12 of the
106 RGAA criteria have actually been decided.

The 81 bundled static checks are **rules, not criteria**. Their relationship is many-to-many:
several rules can evidence one criterion, and a pack can scope one rule to several of its own
criteria. Rule count, criterion coverage and agent worklist size must never be substituted for
one another.

## Non-conformity priorities

- 🔴 **Blocking** — prevents access to content/function (e.g. missing alt, unlabeled
  field, empty link).
- 🟠 **Major** — high impact but workaroundable (heading order, contrast, invisible focus).
- 🟡 **Minor** — light friction (missing caption, redundant ARIA).

## The division of labour (static / rendering / judgment)

ultra11y is honest about what a static analyzer can decide:

- **Automatable (static)** — decided by the engine: missing alt/lang/title, unlabeled
  fields, `iframe` without a title, empty links/buttons, tables without headers, heading
  skips, duplicate `id`s, invalid/broken ARIA, positive `tabindex`, autoplay…
- **Needs rendering** — computed contrast (1.4.3), focus visible (2.4.7), zoom/reflow
  (1.4.4/1.4.10), content on hover/focus (1.4.13). **Out of the engine**: decided by the `scan`
  tier (axe-core in a real browser), flagged as residual risk until then.
- **Agent judgment** — alt relevance (1.1.1), link purpose in context (2.4.4), reading/tab
  order, navigation consistency, caption accuracy…: the AI agent adjudicates these itself from
  the evidence the engine harvests (`verify --manual`, gated), never silently "conforming".

See the full table of the 55 WCAG 2.2 AA success criteria in `references/criteria.md`.

**Preliminary findings.** A finding raised on a `.vue`/`.svelte`/`.astro` source template (or
library-rendered JSX) carries `preliminary: true` in the `--json` output, and the run adds a
`scope.sourceTemplate` (or `scope.rendered`) caveat: the static parse cannot see slot/dynamic
content, so the verdict is provisional — confirm against the rendered DOM or refute it
(`references/rendered.md`, `references/false-positives.md`). It is never silently treated as final.

## Report format (`report`)

`report` writes TWO files side by side, from one derivation:

**`audits/<standard>-YYYY-MM-DD.md` — the report, for every reader** (product owner, project
lead, accessibility referent). It says where the site stands, what to fix and on which pages —
never `file:line`, selectors, tool method or commands:

- **Header** — date, the audited pages (or « source code only »), the headline rate (a pack
  report: the standard's own conformity rate, validated ÷ applicable), the caveats that change
  what a reader may conclude, and the link to the annex.
- **Summary** — the level on the standard's published scale (`conformityLevels` in the pack;
  RGAA: non conforme < 50 % ≤ partiellement conforme < 100 % = totalement conforme), or a
  met / not met / not established verdict for the WCAG core; a « What to fix » table (priority,
  criterion, occurrences, the pages it was found on — linked, or « all pages (N/N) » — and the
  expected fix); and the next steps: what fixing the non-conformities does to the rate, how
  many criteria the next level needs, the criteria still to assess. While criteria are open,
  every figure is a floor.
- **The 5 gated sections**: (1) synthesis by WCAG guideline / theme (C/NC/NA/to assess),
  (2) non-conformities by priority — per criterion: the problem found (the engine's own
  wording; axe-core's English messages and stock remediation are left to the annex), the pages
  concerned with their URL and occurrence count, an evidence crop when `--evidence` drew one,
  the expected fix — (3) conforming criteria, (4) justified not-applicable criteria, (5)
  criteria to assess. Recommendations, the per-page rates (page, URL, rate), the folded
  criteria × pages grid and, per page, its screenshot and the criteria failing there sit
  between (2) and (3).

**`audits/annexe-technique-<standard>-YYYY-MM-DD.md`** (`technical-annex-…` in English) **— the
technical annex**, for the developer and the auditor: tool, scope files, rate computation,
decision provenance, automatic rate, automation contract, every caveat with its command;
(A) each non-conformity's compact auditor block with its `file:line` occurrence checklist,
built from the SAME units `prd` and `tickets` emit (see `references/tickets.md`); (B)
recommendations with their files; (C) each page's basis of judgment and findings with
selectors; (D) the procedure for the criteria to assess; (E) the exhaustive grid.

The report links the annex by its bare file name, and `check`, `verify` (and the MCP tools)
read both as one document: the structure and headline are in the report, the occurrences
`verify` adjudicates and the automatic rate `check` recomputes are in the annex. A report whose
linked annex is missing is refused (exit 2) — keep the two files together.

Pages come from captured snapshots (`.ultra11y/pages/`) or a merged `scan --sample`. A
source-only audit has none, and its summary says so instead of printing an empty column (the
annex gives the command). Declare each sample page's `sources` in `.ultra11yrc.json` so
findings raised on the source code land on their page too; a page list is marked « (at least) »
only when the defect sits in a source several pages declare, because such a finding is
attributed to the first one.

## Worldwide: WCAG core, country standards as packs

WCAG 2.2 Level AA is the engine's canonical key — the worldwide standard. A country
standard (France's RGAA, the US Section 508, the EU's EN 301 549) is a pluggable in-repo
**pack** that maps its criteria onto WCAG success criteria; `report --standard rgaa` (and
`criteria`/`check`/`verify`/`prd --standard <pack>`) re-key the deliverable for that
standard (`rgaa-YYYY-MM-DD.md`). The WCAG report is the canonical, gated one; a pack report
is a derived view. See `references/standards.md`.

**International equivalence (version-accurate)**: Section 508 incorporates WCAG 2.0 AA;
EN 301 549 v3.2.1 references WCAG 2.1 and v4 references WCAG 2.2; AODA references WCAG 2.0
AA. A WCAG 2.2 AA audit therefore covers these standards' web requirements at their
respective WCAG versions.
