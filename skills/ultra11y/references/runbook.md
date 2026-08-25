# The reliable run

One recipe, and the reasons it is that one. Everything here is measured on this repository's
own fixture; the numbers are stated so they can be argued with.

## The recipe

```sh
# 1. The engine decides everything it can, for free.
ultra11y audit <src> --standard rgaa --out audits

# 2. The browser closes the mechanical ones, also for free. DO NOT SKIP THIS.
ultra11y scan --crawl <url> --standard rgaa --merge audits/audit-latest.json --out audits
ultra11y audit <src> --standard rgaa --out audits     # re-ingest the captures

# 3. The model rules on what is left — one criterion per call, recorded.
ultra11y judge --in audits/audit-latest.json --out audits --apply \
  --standard rgaa --runner claude --grain criterion \
  --model claude-haiku-4-5-20251001 --max-budget-usd <n> --concurrency 4 --ledger

# 4. A second reader puts those claims on trial, and the outcome is APPLIED.
ultra11y report --in audits/audit-latest.json --standard rgaa --out audits
ultra11y verify --report audits/<report>.md --in audits/audit-latest.json --out audits --max-verify 0
ultra11y judge --refute audits/VERIFY.todo.json --standard rgaa --runner claude \
  --model claude-haiku-4-5-20251001 --concurrency 4
ultra11y verify --apply audits/VERIFY.todo.json --report audits/<report>.md \
  --in audits/audit-latest.json --out audits --prune --ledger

# 5. The gates. Neither is optional; one asks completeness, the other asks the instrument.
ultra11y check --in audits/audit-latest.json --standard rgaa \
  --require-decided=pages --allow-undecided .ultra11y/undecidable-rgaa.json
ultra11y check --in audits/audit-latest.json --standard rgaa --require-rendered
```

Step 5 prints the line that answers « did all 106 run? » directly:

```
✓ Complete grid: all 106 criteria carry a verdict.
  106 criteria — 55 engine, 12 measured (scan), 37 agent, 2 declared undecidable, 0 with no verdict.
```

## Why this transport

There is only one judge — `applyAdjudication` — and every mode passes through it. What differs
between them is not rigour; it is the transport, the grain, the resume and whether you can see
what it cost.

| | why |
|---|---|
| `--runner claude` | Claude subscription/OAuth, read-only tools, safe mode, real dollar ceiling, wall-clock kill and reported cost. `--runner cli` is its compatibility alias. |
| `--runner codex` | ChatGPT subscription through local `codex exec`, ephemeral/read-only/offline with config, rules and hooks ignored. It inherits the account model unless pinned. Use `--timeout`/`--max`; Codex has no `--max-budget-usd`. |
| `--grain criterion` | One call per criterion, `criteriaId` pinned to that one criterion. A run cut short loses one criterion instead of everything it had ruled on. |
| `--ledger` | A verdict paid for once becomes a claim re-verified on every push by `ledger-gate`. |

Not the others, and for concrete reasons: `--runner api` reports no cost, honours no timeout
and enforces no dollar ceiling. `adjudicate-runner: action` refuses `--grain criterion`, needs `Write`
on the audited repository, has no intra-pass resume, and does not run on `push` at all.
`verify --manual` in a session is free and has the best evidence of any of them — it stays the
recourse for the hard residue, not the recipe.

To run the same recipe on a Codex subscription, replace both `--runner claude` occurrences
with `--runner codex`, remove the Claude model and `--max-budget-usd`, and keep the same RGAA
standard on every phase. A run with `--standard rgaa` builds and adjudicates only the RGAA
criterion grid; it does not launch a second WCAG judgment pass.

## Why step 2 is not optional

`criterionMeasuredOn` requires page coverage. With no capture, **no mechanical criterion can be
closed by measurement** — they stay « à évaluer » and go swell the model's bill instead of
being decided by the engine for nothing. On this repository's fixture the worklist is 81
criteria with no scan. Every criterion the scan closes is one you do not pay ~2 000 input
tokens to have read.

## Why step 4 is not optional either

A cheap adjudicator does not miss things — it **over-accuses**. Measured on a full RGAA pass
with Haiku, against a reference ledger adjudicated by a stronger model through the same gate:

| | |
|---|---:|
| criteria both settled | 48 |
| they agreed on | 24 |
| they disagreed on | 24 |
| …of which Haiku said NC where the ledger said C or NA | 19 |

74 non-conformities against 57. The gate cannot catch this, and that is structural:
`normativeRefResolves` proves the cited test belongs to the adjudicated criterion — and
`11.2.1` really is a test of `11.2`. It never asks whether the reading was right, so an
adjudicator that files « this field has no label » (which is 11.1's) under 11.2 passes cleanly.

The `48` above is the intersection of two measured experiment outputs, **not** a fixed number
of RGAA criteria assigned to the agent. On every real run, read the final provenance tally.
For example, `26 engine + 32 scan + 46 agent + 2 named undecidable = 106` is complete; calling
that “48 agent criteria” would hide both the actual 46 model verdicts and the two explicit
exceptions.

Three things now stand between that and a deliverable, and only the third is a model:

1. **The brief names the neighbour.** A criterion states which of its theme-mates owns the
   adjacent question, derived from the pack's own data — for 11.2 that is 11.1, with its plain
   title beside it.
2. **The fold refuses the double charge.** An NC on a criterion with no engine rule of its own,
   on the exact anchor the engine already failed a mechanical neighbour on, is refused and the
   criterion goes back to « à évaluer » naming that neighbour.
3. **The trial.** One reader, one element, one question — *does the cited evidence establish
   what was claimed?* — with the instruction to refute when in doubt.

## What it costs

Per pass, at criterion grain, for a full RGAA worklist:

| | tokens in |
|---|---:|
| before this was looked at | ≈173 000 |
| today | ≈117 000 |

The 33% came from three cuts, and only the first was free: the verdict contract was being sent
in every brief beside a system prompt that already carried every one of its clauses (28% of the
total, 2 144 characters × 81 criteria); the glossary keeps five terms at 420 characters instead
of eight at 600; and the step-by-step procedure of a test whose mechanism the harvest did not
find in the source is cut to an opening. No test's WORDING is ever abridged.
`tests/adjudicate-context-budget.test.ts` ratchets the result — this is the bill, not a
micro-benchmark.

The refutation pass costs one call per non-conformity and one per cleared citation. The
worklist is capped at 40 by default and the coverage check is rebuilt UNCAPPED, so a bounded
worklist fails the gate as `missing` rather than passing over the half it tried — which is why
step 4 passes `--max-verify 0`. Lower it deliberately if you must, and then say what was
dropped: a silent cap reads exactly like full coverage.

## When it goes wrong

- **The pass decided nothing.** Read the refusals it printed. A criterion the gate refused
  carries its reason in its own justification; it is almost always a brief that never stated
  the rule, or a harvest with no anchor on the criterion's subject — not a model that gave up.
- **The ledger replays as stale.** Its fingerprint covers the evidence the harvest READ FROM
  DISK. A ledger recorded with no `.ultra11y/pages/` fingerprints a smaller set than a real run
  rebuilds, and every entry is dropped as stale, silently. Adjudicate where the captures are.
- **The trial refuses an engine verdict.** It is left untouched and counted, on purpose: a
  criterion the engine decides is recomputed from source every run, and a rule that produces a
  false positive is fixed in the rule.
