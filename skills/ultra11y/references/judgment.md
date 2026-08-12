# Judgment phase (the criteria the AI agent adjudicates)

The engine decides the machine-checkable subset; the **AI agent** (Claude running this skill)
*adjudicates the rest itself*, gated: the **judgment** criteria (alt relevance, link purpose in
context, reading order) it rules on **statically, from the evidence the engine harvests**; the
**rendering** criteria (computed contrast, visible focus, zoom/reflow, content-on-hover) it routes
to the `scan` tier (never source); and it adversarially verifies the detected non-conformities.
This phase makes each verdict defensible and recorded, never invented, never silently "conforming".

## Adjudication loop (the residual/manual criteria) — `verify --manual`

1. **Harvest the worklist** from the audit's cwd (harvesting re-reads the audited source files):
   ```
   node scripts/ultra11y.mjs verify --report audits/wcag-YYYY-MM-DD.md --in audit.json --manual --out .
   ```
   writes an **ADJUDICATION worklist** — `ADJUDICATE.todo.json` + `ADJUDICATE.md`, one item per
   residual (`manual`) criterion, each **pre-loaded with the harvested evidence**: every image's
   `alt`, every link's text + context, the literal colour pairs, control labels, the heading
   outline, ARIA state, `tabindex`, lang-of-parts.
2. **Rule on each item**, filling its `verdict` in `ADJUDICATE.todo.json` (provenance
   `decidedBy: "agent"` is recorded):
   - `C` — conforming, with a `justification` from the evidence;
   - `NC` — non-conforming, with ≥1 **groundable** finding (`file`/`line`/`message`/`snippet`)
     **AND a `normativeRef`** citing the precise failed test of the *active standard* (a WCAG
     technique/SC, or an RGAA test number under `--standard rgaa`). The fold rejects a missing
     `normativeRef`, or one that does not resolve to a real test of the active standard
     (anti-fabrication) — a non-conformity must always name the normative rule it breaks;
   - `NA` — not applicable, with a `justification`;
   - `manual` — undecidable from what is captured, with a `reason`: `"needs-rendered-dom"`
     (decide via `scan`) or `"undecidable"`.
   - `recommendations[]` — a **good practice with no failing normative test** (e.g. "state a
     download link's format/weight", "one `<h1>` per page") is NOT an NC: record it as a
     non-normative recommendation (groundable exactly like an NC, but **no `normativeRef`
     required**). It renders under « Recommandations (non normatives) » and never flips the
     criterion to NC. A purely UX concern is neither an NC nor a recommendation — leave it out.
3. **Fold back FAIL-CLOSED**:
   ```
   node scripts/ultra11y.mjs verify --apply ADJUDICATE.todo.json --in audit.json --out .
   ```
   rejects a null verdict, a `C`/`NA` without a `justification`, an `NC` without a groundable
   finding **or without a resolving `normativeRef`**, a `manual` without a `reason`, or any
   uncovered residual criterion. Agent `NC`s become real `agent:<sc>` findings that re-render in
   the report's §2 and re-enter the verify worklist; `report`/`prd` re-render with the adjudicated
   statuses; §5 shrinks to only the still-`manual` items.

### The decision protocol

Each residual criterion in `ADJUDICATE.md` is pre-loaded, alongside the harvested evidence,
with its **decision protocol** (`src/data/adjudication.json`, both languages, covering ALL 52
criteria the engine cannot decide):

- **the decision rule** — what makes this criterion Conforming vs Non-conforming. Not a hint:
  the rule you apply. A criterion handed over with no stated rule is where an audit quietly
  turns into an opinion;
- **when `NA` is legitimate** — so "not applicable" is a justified verdict rather than an
  escape hatch;
- **the questions** an auditor asks to get there;
- **the citable references** — this criterion's W3C techniques and failures, i.e. exactly the
  set a `normativeRef` may come from. `verify --apply` rejects one that does not resolve, so
  proposing the valid ones is what stops an invented citation.

The same protocol is published as a standalone page, `references/adjudication.md`, generated
from that dataset — read it when you want the whole picture rather than one worklist item.
They are prompts, not verdicts: you still answer from the evidence and record
`C`/`NC`/`NA`/`manual` (+ a recommendation where a good practice has no failing normative
test).
4. **Rendering required**: a `manual` item marked `needs-rendered-dom` (computed contrast, visible
   focus, 200% zoom, 320px reflow, content-on-hover) is decided on the **render** (the `scan` tier,
   or inspection) — never from the source.
5. **Library code (DSFR…)**: a `<Button>`/`<Card>` does not show its HTML in source. Adjudicate on
   the **produced** HTML (see `render` / audit the build), otherwise the verdict is a false
   negative.

## Adversarial verification of the non-conformities — `verify --report`

Unchanged: `node scripts/ultra11y.mjs verify --report audits/wcag-YYYY-MM-DD.md` writes `VERIFY.md`
+ `VERIFY.todo.json`, one entry per detected non-conformity, each grounded in the **WCAG success
criterion's W3C Understanding reference** + techniques. Rule each, opening the file at the cited
line:
- `supported` — the non-conformity is real and correctly tied;
- `partial` — real but the criterion/wording is imprecise;
- `refuted` — false (the cited element is actually conforming);
- `unsupported` — the cited element is not enough to decide.

Then `node scripts/ultra11y.mjs verify --apply VERIFY.todo.json` is green again (fails on any
`refuted`/`unsupported`/missing verdict). `--semantic` folds the support-check into the same pass.

> For a country standard's own test grid, `criteria --standard rgaa <id>` shows the RGAA tests
> behind a WCAG SC. The pre-completion checklist stops you concluding too early. The rule that
> never bends: no residual criterion reaches `C` without a recorded, gated justification.

## Under a country standard, the worklist speaks that standard

`verify --manual --standard rgaa` keys the worklist by **RGAA criteria**, not WCAG success
criteria — which is the granularity that matters, since 99 of RGAA's 106 criteria can only
ever derive `manual`. Each item carries, inline:

- the criterion's **numbered tests, in full** (`11.2.1` … `11.2.6`) — what actually has to be
  ruled on;
- its **technical note** and **particular cases**;
- its **implementation guidance** (before/after), previously reserved for criteria that
  already had a finding;
- the **definitions** of the terms its own tests cite, from the standard's glossary.

**`normativeRef` must cite one of the item's OWN tests.** This is not pedantry: an RGAA test
id has the same `N.N.N` shape as a WCAG success criterion, so a laxer check accepted the WCAG
id an agent naturally reaches for and read it as an unrelated test — citing `1.4.3` (Contrast
Minimum) validated as RGAA test 1.4.3, which is about CAPTCHA images. The worklist now lists
the acceptable references per item, and anything else is rejected.

Verdicts fold into `packAdjudication`, not onto the WCAG criteria: a pack decision must not
rewrite the core verdict, and since WCAG 1.1.1 alone fans out to 19 RGAA criteria, folding by
success criterion would let those criteria overwrite one another.

Look a defined term up on its own with `criteria --standard rgaa --glossary <term>`.

## When no agent is in the loop (`judge`)

Inside a coding agent, the judgment criteria are adjudicated by the agent: `verify --manual`
builds the worklist, the agent rules, `verify --apply` folds the verdicts through the gate.

Outside one — a CI job, a browser extension, an E2E run — nobody rules on them, so they stay
« à évaluer » forever. Honest, and unusable on its own. `judge` closes that:

```
export ANTHROPIC_API_KEY=…            # the ONLY place in the tool that takes a key
node scripts/ultra11y.mjs judge --in audits/audit-latest.json --standard rgaa --out .
node scripts/ultra11y.mjs judge --in audits/audit-latest.json --standard rgaa --apply
```

**It is a caller, not a second judge.** The items and their harvested evidence come from
`buildAdjudicationWorklist`; the prompt is `formatAdjudication` — the same decision protocol,
numbered tests, technical notes, particular cases and glossary the agent reads, so there is no
second protocol to keep in step; and the verdicts go through `applyAdjudication` unchanged.

That last point is what makes the tier trustworthy. A model cannot assert a conformance the
gate refuses:

| It returns | The gate does |
|---|---|
| `C`/`NA` with no justification | rejects the whole adjudication |
| `NC` citing nothing, or a `file:line` that does not resolve against real source | rejects |
| `NC` citing a `normativeRef` belonging to another criterion | rejects |
| `manual` with no reason | rejects |
| a verdict for a criterion nobody asked about | dropped before it reaches the gate |
| fewer verdicts than criteria (a truncated `--max` run, a failed batch) | rejects on coverage |
| all `manual` with reasons | **accepts** — that is a correct answer, not a failure |

A rejected adjudication leaves `audit-latest.json` untouched.

**Strictly opt-in.** With no key the command explains itself and exits 2; nothing else in the
engine changes.

**In the GitHub Action.** `adjudicate: api` runs exactly the command above; `adjudicate: agent`
hands the same worklist — plus `orchestrate --eco`'s runbook and the adjudicator contract — to
a `claude-code-action` run, then folds it with `verify --apply`. The agent mode exists because
`judge` rules from the harvested evidence alone (30 items per criterion, snippets truncated)
while an agent can open the cited files, which is what *link purpose in context* really needs.
Both skip themselves when `ANTHROPIC_API_KEY` is absent from the job environment, and both
absorb their own failure rather than taking the audit down with them. See `references/ci.md`.

`--max` bounds the spend and says out loud which criteria it did not submit. It is **refused
together with `--apply`**, before any call is made: the gate rejects an incomplete
adjudication by design, so the pair could only ever bill you for a guaranteed failure. Drop
`--max` to adjudicate everything, or drop `--apply` to produce the worklist now and fold it
in later.
