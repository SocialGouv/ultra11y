# Auditor backlog (`prd`)

`prd` turns an `AuditResult` into an **auditor-legible conformance backlog**, grouped by WCAG
success criterion (or, with `--standard <pack>`, by a country standard's criteria). It is the
"action" counterpart of `report` (which is the compliance document) — and they are not just
similar, they render the literal **same auditor block** (`src/auditor.ts` `renderAuditorUnit`,
fed by the same `prdUnits`): `report`'s "Non-conformities by priority" section (§2) IS one of
these blocks per NC criterion, grouped by severity exactly like the `prd` backlog and the
ticket bodies `tickets` files (`references/tickets.md`). Change the block once, all four
deliverables change together — there is no separate "report wording" to keep in sync.

`prd` writes MARKDOWN and files nothing. Filing tickets is `tickets`.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --json > audit.json
node scripts/ultra11y.mjs prd --in audit.json                      # auditor backlog (default)
node scripts/ultra11y.mjs prd --in audit.json --split criterion    # one file per criterion
node scripts/ultra11y.mjs prd --in audit.json --standard rgaa --lang fr   # rendered with the RGAA (fr) vocabulary
node scripts/ultra11y.mjs prd --in audit.json --format doc         # product-requirements doc (epics/stories/AC)
node scripts/ultra11y.mjs prd --in audit.json --format remediation # legacy dev fix-backlog
```

## Output

- **Default (`--format audit`) — the auditor conformance block**: one document
  `audits/prd-YYYY-MM-DD.md`, sectioned by priority (🔴 blocking → 🟠 major → 🟡 minor). Each
  criterion becomes a full **ticket** rendered **with the active standard's vocabulary** (see
  `references/standards.md` → *Auditor vocabulary*):
  1. **Auditor block** — **theme** (RGAA *Thématique* / WCAG core *Principle · Guideline*),
     **criterion** + its official wording, **test(s)** (RGAA test numbers `11.6.1` / WCAG
     techniques), **WCAG** mapping + level, **Priorité**, the **finding** (non-conformity,
     labelled with the standard's *non-conformant* verdict), the **expected** conformant state,
     a **verification** method, and the occurrence **checklist** (`file:line`) with the
     cross-file **definition site** (`related`) when present.
  2. **Partie technique / Technical details** — **impacted files** (source paths), **impacted
     pages / URLs** (served locations, each with its sample **page name + auth flag** when
     `scan --sample` provenance is present), the **expected change** + a before/after
     **guidance example** (`references/guidance.md`), **Critères d'acceptation / Acceptance
     criteria** as a Given/When/Then checkbox list, and **Complexité / Complexity** (a
     deterministic t-shirt size + story points).
  3. **Contexte de reproduction / Reproduction context** — emitted only when ≥1 occurrence
     cites a served URL static grounding could not resolve, or a sample page behind
     authentication: the URL, whether auth is required, and the required-state / reproduction
     steps. This is what lets a developer reproduce a scan/`--sample` finding.

  Sections 2–3 are opt-out with **`--no-technical`** (a pure-auditor consumption drops the
  ticket scaffolding, keeping only the auditor block). Everything is localized by `--lang
  fr|en`. The **GitHub issues** below use this same block by default.
- **Advisory findings render as recommendations, never NCs.** A non-normative recommendation
  (an advisory pack rule, or an agent `recommendations[]` verdict) is rendered under
  « Recommandations (non normatives) » / "Recommendations (non-normative)" with a 💡 marker and
  the « Recommandation (non normative) » tag — a distinct, non-parseable list so `verify` never
  captures it as an NC claim. An advisory finding riding along in an otherwise-NC criterion is
  split out under « Recommandations associées ». It never enters the occurrence checklist,
  never flips a criterion to NC, and never counts toward `conformancePct`.
- **`--format remediation` (legacy dev backlog)**: the previous developer-oriented block —
  fix(es), an **effort estimate** (S/M/L), a **before/after example** from the implementation
  guidance (`references/guidance.md`), and the occurrence checklist.
- **`--format doc` (product-requirements doc)**: `audits/prd-doc-YYYY-MM-DD.md` — epics
  grouped by theme, one **user story** per criterion, **Given/When/Then** acceptance criteria
  templated from the real SC title/techniques (anchored to W3C text), and the task list.
- **`--split criterion`**: a `prd-<criterion>-YYYY-MM-DD.md` file per criterion (handy for batching).
- **`--json`**: emits a machine-readable object instead of the file paths —
  `{paths, units}` where `units` is the structured per-criterion backlog an agent can consume.

## Language of the prose (French deliverables)

When you author or extend PRD/issue prose in French (extra context, acceptance criteria,
issue comments), keep technical tokens in English exactly as the engine's fr catalog does:
attribute/element/role names and their values are code, not prose — `aria-live` stays
`aria-live` (never « région live »), same for `tabindex`, `alt`, `role="alert"`. Normative
standard vocabulary (e.g. RGAA « lien d'évitement ») keeps its official French wording.

## Filing these as tickets

See **`references/tickets.md`**: `tickets` files the same auditor blocks into GitHub, GitLab
or Jira, at a granularity you choose (per criterion, per page, per file, or one consolidated).
