# Orchestration — fanning the judgment phases out

The two judgment phases are per-item worklists: `ADJUDICATE.todo.json` holds one entry per
residual criterion, `VERIFY.todo.json` one per detected non-conformity. Neither has
cross-item dependencies, so both fan out cleanly across subagents — and both work exactly as
well done sequentially. This is a wall-clock optimization, never a correctness requirement.

`orchestrate` emits the orchestration from the worklists that CURRENTLY exist, with absolute
paths and the real item ids baked in:

```
node scripts/ultra11y.mjs orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list]
```

## Route by harness

| Your harness | How to run each judgment phase |
|---|---|
| Has the Workflow tool | `orchestrate --run <RUN> --phase <p>`, then run `<RUN>/orchestration/<p>.workflow.mjs`. Subagents RETURN verdict fragments; you fold them into the worklist, then `verify --apply` as usual. |
| Subagents but no Workflow tool | Same `orchestrate`; dispatch one subagent per batch following `<RUN>/orchestration/agents/<role>.md` (the workflow script lists the batches and their prompts). One writer: you fold the results in. |
| Eco mode, or no subagents | `orchestrate --run <RUN> --eco` → follow `<RUN>/orchestration/RUNBOOK.md` sequentially, playing each role yourself. Correctness-identical; only wall-clock differs. |

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

- **Subagents never write.** Every emitted contract ends with the one-writer rule, and the
  fail-closed `--apply` fold always stays with you, the orchestrator. Parallel writers to one
  worklist is how a verdict silently disappears.
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
