# Orchestration — fanning the judgment phases out

The two judgment phases are per-item worklists: `ADJUDICATE.todo.json` holds one entry per
residual criterion, `VERIFY.todo.json` one per detected non-conformity. Neither has
cross-item dependencies, so both fan out cleanly across subagents — and both work exactly as
well done sequentially. This is a wall-clock optimization, never a correctness requirement.

An adjudicating subagent needs **both** files: `ADJUDICATE.todo.json` for the evidence and the
slots its verdict goes into, and `adjudicate/<criteriaId>.md` for the criterion itself — its
official wording, its numbered tests and, under a country standard, that standard's own test
methodology. The JSON carries none of the normative text, and the emitted contracts say so.

`orchestrate` emits the orchestration from the worklists that CURRENTLY exist, with absolute
paths and the real item ids baked in:

```
node scripts/ultra11y.mjs orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list]
```

`orchestrate --run <dir> --manifest --json` prints the same loop as data — each step's
command/argv, inputs, outputs, exit-code contract and next step — for an orchestrator that is not
a coding-agent session, such as a workflow engine or a non-GitHub CI (see `references/orchestrators.md`). The RUNBOOK is one renderer of it.

The `verify-report` commands it emits — generation, fold, the refuter's fold line and the
semantic gate — all carry **one run context**: the run's audit (`--in <RUN>/audit-latest.json`,
or the `--in` the list was generated with), its `--standard`, and the explicit conformity source
the list was built from (`--conformities <file>` / `--no-conformities`), read back from
`<RUN>/VERIFY.context.json`. Without `--in`, a directory with no ledger produces a list that tries
the report's non-conformities and silently skips every conformity the adjudication cleared; the
fold then counts them « missing ». Keep the same context on both sides — `--max-verify 0` cannot
repair a list generated from another claim source, only regenerating it can.

## What `orchestrate` writes

For each ready phase `<p>` (`adjudicate`, `verify-report`), under `<RUN>/orchestration/`:

```
<p>.batches.json          the batches as data — the canonical, harness-neutral output
<p>/<batch-id>.md         one self-contained prompt per batch (batch ids: <p>-01, <p>-02, …)
out/<p>/                  where each batch's answer is saved: out/<p>/<batch-id>.json
<p>.workflow.mjs          the Claude Code Workflow-tool adapter, rendered from the same batches
agents/<role>.md          the dispatch contracts (adjudicator, refuter)
RUNBOOK.md                the sequential path, and where the batch files are
```

`<p>.batches.json` is `{ kind: "ultra11y-orchestration-batches", schemaVersion: 1, phase, role, run,
engine, worklist, items, batchSize, schema, fold, batches[] }`. Each batch carries its `id`,
`role`, `ids` (its `ITEMS=`), `items` (the exact worklist entries it rules on), `contract`,
`prompt`, `output`, `schema` (what its answer must validate against) and `fold` (the engine
command the sole writer runs once every answer is in). The prompt file holds all of that in
prose: the items, the criterion briefs to read, the role contract inline, the schema and the
output path. Hand it to a subagent **verbatim**; nothing else needs passing.

The workflow script's `BATCHES` and the manifest's `batches` / `batchIds` / `prompts` /
`batchOutputs` come from the same batch record, so no adapter can dispatch a different partition.
`--eco` writes neither batches nor workflow, and removes any left over.

## Route by harness — one contract, every harness

Every recipe ends the same way: **each subagent returns one JSON object that validates against
its batch's `schema`; that JSON is saved at the batch's `output`; you, the main agent and the
only writer, fill the worklist from those answers and run the batch's `fold`** (`verify --apply`
for the phase). The gates do not know which harness produced the verdicts.

- **Claude Code.** `orchestrate --run <RUN> --phase <p>`, then either
  `Workflow({ scriptPath: "<RUN>/orchestration/<p>.workflow.mjs" })`, which dispatches every
  batch and returns the fragments, or, where the Workflow tool is not available, one Agent-tool
  subagent per `<RUN>/orchestration/<p>/<batch-id>.md`, each handed that file as its prompt.
  Save each fragment at its batch's `output`, then fold.
- **Codex.** Same `orchestrate`. Spawn one subagent per prompt file under
  `<RUN>/orchestration/<p>/` and hand it the file's contents as its task. Save each returned
  JSON at the batch's `output` (or let the subagent write it there itself, the one file the
  prompt allows it), then fold.
- **OpenCode.** Same `orchestrate`. One Task-tool call per prompt file, the file's contents as
  the task prompt. Save each returned JSON at the batch's `output`, then fold.
- **No subagents, or eco.** Either walk the prompt files yourself, one after another, saving
  each answer at its `output` before folding, or skip the batches altogether:
  `orchestrate --run <RUN> --eco` and follow `<RUN>/orchestration/RUNBOOK.md`, filling the
  worklist in place. Both are correctness-identical to the fan-out; only wall-clock differs.

Saved answers under `out/<p>/` are yours to fold; `orchestrate` never deletes them. After the
fold, clear them before the next fan-out over a regenerated worklist.

## The other dispatch: the review

The judgment phases are not the only thing that leaves this skill. Once the audit has
produced fixes, the **`review-a11y` skill** reviews the code under change — dispatched the
same way, and read from the same table:

| Your harness | How to run the review |
|---|---|
| Subagents (Workflow tool or not) | One subagent, one prompt: use the `review-a11y` skill on the change, return its report verbatim. |
| No subagents | Invoke `review-a11y` directly, in this session. |

It differs from a judgment batch in one way that matters: **the review is not a worklist**.
Nothing is folded back, no gate re-reads it, and it writes nothing — so the one-writer rule
below is satisfied trivially, and there is no `--apply` step to keep. What comes back is a
report for a human.

## The rules that do not bend

- **Subagents never write the worklist.** Every emitted contract ends with the one-writer rule,
  and the fail-closed `--apply` fold always stays with you, the orchestrator. The one file a
  subagent may write is its own batch's `output`, and only when its harness cannot return the
  JSON. Parallel writers to one worklist is how a verdict silently disappears.
- **The gates are harness-independent.** `check` and `verify --apply` behave identically
  whether one agent or twelve produced the verdicts, so a fan-out can never buy a greener
  result than the sequential path.
- **Re-run `orchestrate` whenever a worklist changes.** Emission is deterministic and
  idempotent, so re-running is free and keeps the batches aligned with reality.
- `--phase <p>` before its worklist exists fails, and names the command that produces it.

## Splitting the work sensibly

An adjudication batch should hold criteria that share context — the media criteria together,
the form criteria together — so each subagent reads one part of the codebase rather than all
of it. The emitted contracts already group this way; if you dispatch by hand, keep it.

A subagent adjudicating a criterion needs the same three things you do: the harvested
evidence, the decision rule (`references/adjudication.md`), and the reminder that a
non-conformity must cite a normative test that resolves. Point each contract at the relevant
knowledge reference rather than restating it — a paraphrase drifts.
