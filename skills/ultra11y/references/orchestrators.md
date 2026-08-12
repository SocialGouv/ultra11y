# Drive the engine from an orchestrator

The skill and the GitHub Action assume a person or a coding harness is in the loop. An
**orchestrator** — an agent workflow engine, a CI job that is not GitHub, a cron runner —
is different: nothing reads a banner, nothing retries on a hunch, and the only things that
travel between steps are exit codes and JSON. This page is the contract for that caller.

The shape that matters: **the engine finds, the agent adjudicates, the gates refuse.** Keep
the detection deterministic and there is no model between "a defect exists" and "a defect is
counted" — which is the whole reason to wire the engine in rather than ask a model to audit.

## Resolving the engine

Pin the version. `npx` resolves `latest` otherwise, so what runs can change with no commit
anywhere.

```sh
npm_config_update_notifier=false npx -y ultra11y@2.31.2 --version   # → 2.31.2, exit 0
```

- **`npm_config_update_notifier=false` is not optional.** Without it npm prints its
  "New major version available" notice into the output a step is about to parse.
- **`ULTRA11Y_BIN`** points at an engine you already have (a vendored `ultra11y.mjs`, a
  container layer). The engine is one self-contained file with no runtime dependencies, so
  vendoring is a supported path — that is exactly what the skills and the Action do.
- **Node ≥ 22.18.** No other system dependency, no API key. (`judge` takes a key; nothing
  else does. `scan` needs a browser tier — see `references/dynamic.md`.)
- **Verify what you resolved, and fail if it is not what you asked for.** A step that lets a
  missing engine fall through reports zero findings, which reads exactly like a clean audit.
  This is the one failure mode worth being loud about.

## The pipeline

Six steps. Four are deterministic; only step 3 involves a model.

```sh
ENGINE="npx -y ultra11y@2.31.2"        # or "node $ULTRA11Y_BIN"
RUN=/tmp/a11y-run                          # out-of-tree: see "Where output lands"

# 1. FIND — the static engine. No model. This is the finding set.
$ENGINE audit "<globs>" --graph --out "$RUN" --json --lang en > /dev/null
#    …or, on a pull request, exactly what the branch introduced:
$ENGINE audit --since "$BASE_REF" --graph --out "$RUN" --json --lang en > /dev/null

# 2. WORKLIST — a draft report, then the criteria a static pass cannot decide.
$ENGINE report --in "$RUN/audit-latest.json" --out "$RUN" --lang en > /dev/null
$ENGINE verify --report "$RUN"/wcag-*.md --in "$RUN/audit-latest.json" --manual --out "$RUN" --json

# 3. ADJUDICATE — hand $RUN/ADJUDICATE.todo.json to the agent; it fills every `verdict`.
#    The file carries its own `contract` (see below) — the agent needs nothing else.

# 4. FOLD — fail-closed. Exit 1 with per-criterion reasons if a verdict is unsupported.
$ENGINE verify --apply "$RUN/adjudication.json" --in "$RUN/audit-latest.json" --out "$RUN" --json

# 5. REPORT — deterministic rendering of the adjudicated audit.
$ENGINE report --in "$RUN/audit-latest.json" --out audits --standard rgaa --lang fr

# 6. GATE — integrity. Exit ≠ 0 on an invented criterion or unjustified NA.
$ENGINE check --report audits/rgaa-*.md --in "$RUN/audit-latest.json" --json
```

Step 4 is the one to understand: it is a **deterministic gate on the model's output**. A
verdict with no justification, an NC with no resolvable `normativeRef`, a criterion missing
from the adjudication — each is refused by name, and the run stops. That is what keeps the
final report defensible.

**The shipped GitHub Action now runs this pipeline for you.** `adjudicate: agent` performs
steps 2–4 — `verify --manual`, then `orchestrate --run audits --phase adjudicate --eco`, then a
`claude-code-action` run pointed at the emitted `RUNBOOK.md`, then `verify --apply`. Reach for
the raw pipeline above when your orchestrator is *not* GitHub Actions, or when you want to fan
step 3 out across subagents rather than walk the eco path. Either way steps 1, 2, 4, 5 and 6
stay deterministic, and only step 3 involves a model.

## The adjudication contract

`ADJUDICATE.todo.json` declares what may be written into it, so the filler never has to read
ultra11y's source:

```jsonc
{
  "contract": {
    "verdicts": ["C", "NC", "NA", "manual"],
    "manualReasons": ["needs-rendered-dom", "undecidable"],
    "requires": {
      "C":  "a non-empty justification AND citations[] naming the harvested evidence it cleared …",
      "NA": "a non-empty justification",
      "NC": "at least one groundable finding, each citing a normativeRef that resolves against the active standard",
      "manual": "a reason ∈ {needs-rendered-dom, undecidable}"
    }
  },
  "items": [ /* one per criterion the engine could not decide; fill `verdict` */ ]
}
```

Note what `C` costs: a clearing verdict is gated exactly like an accusing one. It must
name in `citations[]` the evidence it cleared, each anchor resolvable and drawn from that
criterion's own harvested evidence — and a criterion presented with **no** evidence cannot
be `C` at all. This is what stops "C everywhere with a plausible sentence" from passing.

The header is **advisory**. `verify --apply` validates against its own constants, so editing
the contract in the file widens nothing.

Verdicts are matched **case-insensitively** (`na` is `NA`, `MANUAL` is `manual`) — a spelling
accident is not a disagreement about accessibility. A verdict outside the vocabulary is still
refused, and the message names the four that are not.

`manual` is the honest verdict for anything that genuinely needs a rendered page. It keeps
the criterion in `residualRisks`, where the report declares it as a residual risk. **Never
map an undecided criterion to `C`** — that is the one way to turn this pipeline back into
the thing it replaces.

## Filing findings on a tracker

`tickets` files into **GitHub, GitLab or Jira** directly (see `references/tickets.md`). For
any other board — a native kanban, an internal tool — take the same items as JSON and file
them yourself:

```sh
$ENGINE tickets --in "$RUN/audit-latest.json" --out "$RUN" --lang en
# → $RUN/issues-<date>.json   (writing the set files nothing; add --dry-run to be explicit)
```

`--grain` decides what one item is: `criterion` (default), `page`, `page-criterion`,
`single` or `file`. The envelope and the item shape are the same at every grain.

```jsonc
{
  "tool": "ultra11y", "kind": "issues", "schemaVersion": 1,
  "standard": "wcag", "grain": "criterion", "date": "2026-08-12", "count": 4,
  "issues": [{
    "title": "[a11y] WCAG 1.1.1 — Non-text Content",   // the de-dupe grain: stable across runs
    "body": "…",                                       // the auditor block, rendered
    "labels": ["accessibility", "wcag", "bloquant"],
    "severity": "bloquant",
    "advisory": false,                                 // true ⇒ a good practice, NOT a non-conformity
    "scope": { "grain": "criterion", "criteriaId": "1.1.1" },
    "occurrences": [{ "file": "src/Page.tsx", "line": 4, "selector": "img", "message": "…" }]
  }]
}
```

At the default grain, one issue per criterion, not per occurrence — a missing `alt` on forty
images is one item with forty `occurrences`, not forty tickets. **De-dupe is on `title`**, so
re-running files nothing twice; keep `--lang` stable across runs, since a criterion's wording
is part of its title. `advisory: true` marks a non-normative recommendation: it must not be triaged as a
non-conformity, and it never enters the conformance rate.

## Where output lands

`--out <dir>` fully contains what a command writes: pointed outside the checkout, an audit
leaves the target repository byte-identical. That matters when the orchestrator audits a
repo it does not own — write the run's intermediates out-of-tree and let only the final
dated report land in the project, if at all.

`.ultra11y/pages/` is written only by the page-snapshot commands (`scan`, `snapshot`,
`dev`); `--root` relocates it. `audit`, `report`, `prd`, `tickets`, `verify` and `check`
never touch it.

## Exit codes

| | 0 | 1 | 2 |
|---|---|---|---|
| `audit` | reported (no `--fail-on`), or clean | findings ≥ `--fail-on` | usage / bad input |
| `verify --apply` | folded | the adjudication was refused (see `issues[]`) | usage / bad input |
| `check` | report is sound | integrity failure | report not found / bad input |
| `prd` | written | — (it writes markdown and files nothing) | usage / bad input |
| `tickets` | filed, skipped, or nothing to file | a creation failed, the provider is unusable, or no page in scope | usage / bad input / past `--max-tickets` |

Read exit codes from the process, **not** from a pipeline — `cmd --json | head` reports
`head`'s status, which is how a failing gate reads as a pass.

## What the JSON tells you

- `audit --json` → the `AuditResult` (also at `<out>/audit-latest.json`): `findings[]` with
  stable `findingId`, `criteriaId`, `severity`, `file`, `line`; `residualRisks[]`;
  `conformancePct` — the **automatic static pass rate**, not a conformance rate.
- `verify --apply --json` → `{ ok, auditPath, applied, stillManual, conformancePct, findings, grounding }`
  on success; `{ ok: false, issues[], audit }` when refused.
- `check --json` → `{ ok, issues[] }`.

## Honesty rules an orchestrator has to carry

The engine is explicit about what it did not decide; a wrapper that flattens that away
produces exactly the false clean bill of health this design exists to prevent.

1. **A missing engine is a failure, never an empty finding set.**
2. **Report the residual criteria.** The rendering criteria (contrast, focus, zoom, reflow)
   are undecided until `scan` runs. Say so; do not let a step summary imply full coverage.
3. **`conformancePct` is the static pass rate.** Label it as such.
4. **Never let a model write the counts.** Take them from the JSON — the numbers exist
   precisely so nothing has to be re-derived by a model that may drop a field.
