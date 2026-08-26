# Judgment phase (the criteria the AI agent adjudicates)

The engine decides the machine-checkable subset; the **active coding agent**
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

**It is keyed by WCAG success criterion, and under a country standard it is not the
instrument.** A pack criterion has its own — see the next section. It is inherited through the
crosswalk only by a pack criterion that carries none, and the brief says so when that happens:
an SC routinely asks a broader question than the criterion mapped onto it.
They are prompts, not verdicts: you still answer from the evidence and record
`C`/`NC`/`NA`/`manual` (+ a recommendation where a good practice has no failing normative
test).
4. **Rendering required**: a `manual` item marked `needs-rendered-dom` (computed contrast, visible
   focus, 200% zoom, 320px reflow, content-on-hover) is decided on the **render** (the `scan` tier,
   or inspection) — never from the source.
5. **Library code (DSFR…)**: a `<Button>`/`<Card>` does not show its HTML in source. Adjudicate on
   the **produced** HTML (see `render` / audit the build), otherwise the verdict is a false
   negative.

## When the adjudicator has no shell (CI)

`verify --manual` writes the worklist **twice**, plus one brief per criterion:

| file | for |
|---|---|
| `ADJUDICATE.todo.json` · `ADJUDICATE.md` | a session **with a shell**: evidence inline, edit in place, fold yourself |
| `ADJUDICATE.verdicts.json` | the **only file to write** when you have no shell — verdicts, no evidence |
| `adjudicate/<criteriaId>.md` | one small brief per criterion: its evidence, the criterion's own wording and tests (with the standard's test methodology), its glossary terms and its citable tests |

Why the split exists, measured rather than assumed: under RGAA, up to 97 criteria carry
judgment tests. A measured worklist carried 1590 harvested anchors — **536 KB** of JSON and
**466 KB** of Markdown. An agent given
`Read/Grep/Glob/Edit/Write` cannot work with that: reading either document swamps its context,
and filling 96 verdicts inside half a megabyte is 96 exact-match edits. A real CI run spent 75
of 424 turns, hit 17 permission denials trying to run the commands the runbook prescribes, and
returned the file untouched — so the fail-closed fold discarded all 96 verdicts and every
criterion stayed « to assess », in a job that reported success. The verdicts file is **37 KB**
for the same worklist, and each brief is a few KB.

`verify --apply` accepts either file. Given the verdicts-only one it **re-derives the evidence
from the audit** (the worklist is a pure function of the audit) and then runs the identical
fold: same coverage checks in both directions, same citation matching against *that criterion's*
own anchors, same refusals. The smaller surface buys nothing from the gate — a `C` that cites
an anchor it was never shown is refused exactly as before.

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
criteria — which is the granularity that matters, since 97 of RGAA's 106 criteria carry
judgment tests and may still need adjudication to earn C. Each item carries, inline:

In total, **104 of RGAA's 106** criteria still need adjudication to earn C; the other seven
beyond the 97 have deterministic failure detectors but no complete positive proof.

- the criterion's **numbered tests, in full** (`11.2.1` … `11.2.6`) — what actually has to be
  ruled on;
- under each test, the standard's **official test methodology** — the procedure it publishes
  for that test, step by step (RGAA documents all 258 of its tests). The test states WHAT is
  required; this states HOW it is verified, in the referential's own words. This is the
  decision rule under a pack, and it is why the WCAG protocol above is not borrowed here;
- a **⬤** on the tests whose MECHANISM appears in the harvested source — the tag or attribute
  the test names itself, matched against the markup the harvest actually found. RGAA 11.2 asks
  the same question over six labelling mechanisms; on a page that labels with `<label>`, one of
  the six is marked. It is **strictly additive**: an unmarked test asserts nothing and is still
  yours to rule on, and the brief says so, because an adjudicator skipping a test that does
  apply publishes a false conformity no downstream gate can catch;
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

Each brief also cites the **official page** for its criterion
(`https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.2` for RGAA; the W3C
Understanding page for the WCAG core). The URL is always printed — it says where the vendored
text came from. Whether the brief also *invites* you to go read it depends on the harness:
`verify --manual` offers it by default and suppresses it under CI, where the adjudicator holds
Read/Grep/Glob/Edit/Write and no network (`--web` / `--no-web` override either way).

**A web lookup can only lift an ambiguity of wording.** The vendored text is the normative
one and it is what decides; a page you fetched never contradicts it, never widens a test, and
is never an acceptable `normativeRef` — only the references the brief lists are.

Look a defined term up on its own with `criteria --standard rgaa --glossary <term>`.

## When no agent is in the loop (`judge`)

Inside a coding agent, the judgment criteria are adjudicated by the agent: `verify --manual`
builds the worklist, the agent rules, `verify --apply` folds the verdicts through the gate.

Outside one — a CI job, a browser extension, an E2E run — nobody rules on them, so they stay
« à évaluer » forever. Honest, and unusable on its own. `judge` closes that through an API or
an already authenticated local CLI:

```
export ANTHROPIC_API_KEY=…
node scripts/ultra11y.mjs judge --in audits/audit-latest.json --standard rgaa --runner api --out .
node scripts/ultra11y.mjs judge --in audits/audit-latest.json --standard rgaa --runner claude --apply
node scripts/ultra11y.mjs judge --in audits/audit-latest.json --standard rgaa --runner codex --apply
```

**It is a caller, not a second judge.** The items and their harvested evidence come from
`buildAdjudicationWorklist`; the prompt is `formatAdjudication` — the same decision protocol,
numbered tests, technical notes, particular cases and glossary the agent reads, so there is no
second protocol to keep in step; and the verdicts go through `applyAdjudication` unchanged.

That last point is what makes the tier trustworthy. A model cannot assert a conformance the
gate refuses:

| It returns | The gate does |
|---|---|
| `C`/`NA` with no justification | refuses THAT criterion |
| `NC` citing nothing, or a `file:line` that does not resolve against real source | refuses it |
| `NC` citing a `normativeRef` belonging to another criterion | refuses it |
| `manual` with no reason | refuses it |
| a verdict for a criterion nobody asked about | dropped before it reaches the gate |
| fewer verdicts than criteria (a bounded `--max` run, a failed batch) | the missing ones stay « à évaluer »; the rest lands |
| all `manual` with reasons | **accepts** — that is a correct answer, not a failure |

**The fold is fail-closed per VERDICT, not per FILE.** No refused verdict is ever applied, and a
refusal costs its own criterion and nothing else: that criterion stays « à évaluer » carrying the
refusal as its reason, and every verdict that proved itself lands. This is not a loosening of the
gate — every check above is unchanged — it is a change of blast radius, and it was measured:
a CI run filled 95 of 96 verdicts correctly, one came back `null`, and the old file-level fold
discarded all 96, so a $16 adjudication published « à évaluer » across the whole grid in a job
that reported success.

`--strict` restores the all-or-nothing fold for a caller who genuinely wants it (a deliverable
signed off in one pass); there, a rejected adjudication leaves `audit-latest.json` untouched.

Whatever lands can be RECORDED with `--ledger <path>` and replayed on a later run with no model
in the loop — see `references/ci.md`.

**Strictly opt-in.** The API transport needs `ANTHROPIC_API_KEY`; Claude and Codex reuse their
local CLI login. `cli` remains an alias of `claude`. Codex runs ephemerally, read-only and
offline, with project instructions, user config, rules and hooks disabled. Its subscription
has no dollar-budget flag, so `--max-budget-usd` is rejected; use `--timeout` and `--max`.
Nothing else in the engine changes.

The standard is one pipeline choice, not an extra comparison pass. With `--standard rgaa`,
the worklist, schemas, verdict ids and fold are RGAA-only; WCAG remains internal crosswalk
plumbing and is not separately adjudicated.

**In the GitHub Action.** `adjudicate: api` runs exactly the command above; `adjudicate: agent`
hands the same worklist — plus `orchestrate --eco`'s runbook and the adjudicator contract — to
a `claude-code-action` run, then folds it with `verify --apply`. The agent mode exists because
`judge` rules from the harvested evidence alone (30 items per criterion, snippets truncated)
while an agent can open the cited files, which is what *link purpose in context* really needs.
Both skip themselves when `ANTHROPIC_API_KEY` is absent from the job environment, and both
absorb their own failure rather than taking the audit down with them. See `references/ci.md`.

`--max` bounds the spend and says out loud which criteria it did not submit. It now composes
with `--apply`: the fold is per-verdict, so a bounded run lands what it covered and the rest stay
« à évaluer » — which is exactly what bounding spend is for. (It used to be refused outright, and
rightly so while the fold was all-or-nothing: the pair could only ever bill a full run to
guarantee a coverage failure. That refusal survives under `--apply --strict`, where it is still
true.)
