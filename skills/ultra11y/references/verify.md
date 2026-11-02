# `check` and `verify` gates

Two assurance levels before shipping a report, plus the agent-adjudication worklist.

## `check` — structural integrity

```
node scripts/ultra11y.mjs check --report audits/wcag-YYYY-MM-DD.md
```
Pass the report itself; the technical annex it links to (`annexe-technique-…md` /
`technical-annex-…md`, same directory) is read with it, and a missing annex is refused (exit 2).
Fails (non-zero) if: one of the 5 sections is missing, a cited criterion id does not exist in
the active standard, an `NA` criterion has no justification, or the pass rate is absent. This
is the baseline anti-hallucination guard. `--quiet` emits only the exit code; `--json` the
structured list of problems. For a country pack report, add `--standard <pack>` so the right
id grammar/registry is validated.

### Semantic gate — `check --report … --semantic`

```
node scripts/ultra11y.mjs check --report audits/wcag-YYYY-MM-DD.md --semantic [--verdicts VERIFY.todo.json]
```
Fails **closed** if there is no adjudicated verdicts artifact (never green-but-inactive),
re-runs the **uncapped** coverage check, and re-grounds every passing verdict against the cited
source. `--verdicts` points at the artifact (default `VERIFY.todo.json` next to the report).
A `file` that is a served URL (a rendered finding whose page has no `.ultra11y/pages` capture
mapped back to source) is not a path to re-open: it is skipped like `stdin`, never reported as
« cited file not found ».

### Applicability gate — `check --report … --standard rgaa --in audit.json`

```
node scripts/ultra11y.mjs check --report audits/rgaa-YYYY-MM-DD.md --standard rgaa --in audit.json
```
Re-derives the pack view from the audit and fails on any **over- or under-projected** NC — the
RGAA applicability gate, so a pack report can neither drop nor invent a criterion vs the WCAG core.

## `verify` — adversarial verification of non-conformities

```
node scripts/ultra11y.mjs verify --report audits/wcag-YYYY-MM-DD.md --semantic
```
Generates a **worklist** `VERIFY.md` + `VERIFY.todo.json`: one entry per non-conformity
(criterion ↔ `file:line` ↔ cited claim), and — by default — one per agent-claimed conformity or
« non applicable » (`kind: "c"`, with its `citations[]`). `--max-verify` caps the
non-conformities (default 40); the conformity half is uncapped unless `--max-verify` is given,
because a trial cut short lets every claim past the cap keep counting as conforming. Whatever
a cap drops is named on stderr and fails `--apply` as « missing »; `--max-verify 0` removes
the cap. `VERIFY.todo.json` is a bare JSON array of entries (unlike `ADJUDICATE.todo.json`,
an object with `items`).

**Generate and apply with the same context.** The claimed conformities come from `--in <audit.json>`
(the audit the report came from), else `--conformities <file>`, else the standard's ledger in the
current directory. With none of them only the non-conformities are tried — the generation warns,
and a green `--apply` says it covered non-conformities only. The list's context is recorded beside
it in `VERIFY.context.json` (audit, standard, conformity source, what a cap dropped), so when
`--apply` finds claims « missing » it tells a cap (`--max-verify 0` fixes it) from a list built from
another claim source (regenerate it with the apply's `--in`/`--standard`/`--conformities`; lifting
a cap that never applied changes nothing). `--no-conformities` and `--max-verify` stay available,
and make a partial trial. For each entry, open the cited code and assign a verdict in
`VERIFY.todo.json`:

- `supported` — the non-conformity is real;
- `partial` — real but the criterion/wording is imprecise;
- `refuted` — false (the cited element is actually conforming);
- `unsupported` — the cited element is not enough to decide.

In `--semantic` mode, explicitly confirm the cited snippet **supports** the non-conformity.
The worklist-generation step also accepts `--json` (emits `{mdPath, todoPath, count, items}`
so an agent can fill verdicts in-memory). **Prioritise `preliminary` findings** (SFC/library
source, see `references/false-positives.md`): refute the ones the rendered DOM disproves.
Then apply the gate:
```
node scripts/ultra11y.mjs verify --apply VERIFY.todo.json --report audits/wcag-YYYY-MM-DD.md --in audit.json
```
The gate fails (non-zero) if any entry is `refuted`, `unsupported`, or unadjudicated. Every
retained claim is also re-grounded against the cited source. A conformity is grounded the way
the fold grounded it: a citation that is one of its criterion's own harvested anchors falls
back to that anchor (the engine read its snippet out of the file), so a retyping the fold
accepted at `verify --apply <adjudication>` is not refused again at trial — pass `--in
<audit.json>` so the harvest can be re-derived; a citation that is NOT one of the criterion's
anchors must still match the source literally. Goal: no fabricated non-conformity survives
into the final report, and no accepted conformity is re-refused one gate later.

**An agent's « non applicable » stands trial too.** An NA clears a criterion (the audit folds it
to `C`, and the rate counts it as conforming), so the worklist carries it like any claimed
conformity. When it cites nothing — the usual case: nothing was harvested for the criterion —
the item is marked `uncited` and asks the scope-level question instead: is there REALLY nothing
on the audited pages the criterion is about? An empty harvest is not proof: a page with content
always has a reading order (RGAA 10.11, 10.12, 13.9), a focus order (12.8) and markup to
validate (8.2). Refuted or unsupported, the criterion goes back to « à évaluer ». The one NA that
is NOT tried is the one the engine's own absence fold already proves — every subject of the
criterion is an element species (`<img>`, `<table>`, a form control…) and none exists anywhere in
the scope.

### The counter-review summary — `verify --summary`

```
node scripts/ultra11y.mjs verify --summary --verdicts VERIFY.filled.json --report audits/rgaa-YYYY-MM-DD.md \
  --in audit.json --standard rgaa [--pruned pruned/audit-latest.json] [--out <dir>] [--json]
```
Writes `TRIAL.md` (or the same data as JSON on stdout): the bilan of one trial, **read-only**. It
names the audit, verdicts, report and pruned audit it was built from (path, date, sha256), then
separates:

- **coverage** — claims expected from this report and this `--in` audit, covered, missing, and
  *foreign* (verdicts for claims this audit does not make: a list drawn from another audit);
- **verdicts**, counted in claims per kind (non-conformity / claimed conformity) — `supported`,
  `partial`, `refuted`, `unsupported`, blank, invalid, missing — with the distinct criteria apart;
- **confirmed findings** (`supported`/`partial`), each with its note;
- **withdrawals applied** — an agent judgement `--prune` withdrew, shown applied only when the
  `--pruned` audit no longer carries it; without `--pruned` every withdrawal is listed as *not
  shown applied*;
- **contested engine decisions — unresolved** (`skippedEngine`): `--prune` leaves them in the audit
  and the report on purpose; the bilan never turns them into a conformity or a confirmed finding;
- **never tried** claims;
- **the semantic gate** (`check --semantic` on this report and these verdicts) **apart from** the
  verdicts' application (`verify --apply … --prune` accepted or refused).

The headline says « counter-review run — audit NOT validated » until the gate is green with
nothing missing, foreign or contested. All three inputs are required — no ledger and no
`VERIFY.todo.json` next to the report is ever picked up — and the command exits 0 once the bilan is
written: it is a report, `check --semantic` stays the gate.

## `verify --manual` — adjudicate the residual (judgment / needs-rendering) criteria

The **AI agent** decides the `manual` criteria itself, gated. Run from the audit's cwd
(harvesting re-reads the audited source files):
```
node scripts/ultra11y.mjs verify --report audits/wcag-YYYY-MM-DD.md --in audit.json --manual --out .
```
This emits an **ADJUDICATION worklist** — `ADJUDICATE.todo.json` + `ADJUDICATE.md`, one item per
residual criterion, pre-loaded with the engine's harvested evidence (every image's `alt`, every
link's text + context, the literal colour pairs, control labels, the heading outline, ARIA state,
`tabindex`, lang-of-parts). Fill each item's `verdict` (provenance `decidedBy: "agent"` recorded):

- `C` / `NA` — with a `justification` from the evidence;
- `NC` — with ≥1 **groundable** finding (`file`/`line`/`message`/`snippet`);
- `manual` — with a `reason`: `"needs-rendered-dom"` (decide via `scan`) or `"undecidable"`.

Fold the verdicts back FAIL-CLOSED:
```
node scripts/ultra11y.mjs verify --apply ADJUDICATE.todo.json --in audit.json --out .
```
It rejects a null verdict, a `C`/`NA` without a `justification`, an `NC` without a groundable
finding, a `manual` without a `reason`, or any uncovered residual criterion. A verdict for a
criterion that is no longer open — one a previous fold already decided — is likewise refused by
name (« not open for adjudication »), never re-applied: re-folding the same file on the
written-back audit answers `ok: false` with that criterion in `rejectedCriteria[]`. Agent `NC`s become
real `agent:<sc>` findings that re-render in the report's §2 and re-enter the verify worklist;
`report`/`prd` re-render with the adjudicated statuses; §5 shrinks to only still-`manual` items.
A `manual` verdict — or a coverage gap — on a criterion the engine had provisionally closed for
want of a subject stays in §5 only: it is never counted in the NA column, which remains a subset
of §3's C.

## Residual risk

After adjudication, only the criteria the agent marked `manual` (`needs-rendered-dom` /
`undecidable`) stay in the report's "to assess manually" section — never mark them conforming
without a recorded, gated justification (agent adjudication via `verify --manual`, or `scan`
evidence for the rendering criteria).
