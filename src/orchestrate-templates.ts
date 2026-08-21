import { join } from "node:path";
import type { PhaseInfo } from "./orchestrate.js";

// ---------------------------------------------------------------------------
// Templates for `ultra11y orchestrate` — the generator that turns the run's
// CURRENT worklists into a launchable multi-agent Workflow per phase, the
// dispatch contracts it references, and a sequential RUNBOOK fallback.
// Everything here is emitted by string concatenation with the run's constants
// injected as JSON literals, so the workflow runs as-is under the Workflow
// tool: `export const meta` stays a pure literal, and no emitted line ever
// calls Date.now()/Math.random()/new Date() (they throw in that harness).
// ---------------------------------------------------------------------------

/** Family-standard footer: subagents return fragments; the orchestrator is the sole writer. */
const ONE_WRITER_FOOTER = `
## Return, don't write

Return ONLY the structured output specified above. Do NOT write, edit, or delete any file; do NOT run any engine command that writes (\`verify --apply\`, \`fix --write\`, \`audit --out\`, \`init\`). The orchestrator is the sole writer — it folds your verdicts into the worklist itself and runs the apply gate. Exception: if a justification is prose too large to return, write ONLY to \`<RUN>/orchestration/out/<role>-<batch>.md\` (a file namespaced to you alone) and return its path.
`;

// Structured-output schemas the emitted workflows pass to agent(..., { schema }).
// They mirror the fail-closed rules `verify --apply` enforces, so a fragment that
// validates here still gets re-checked (grounding, required justifications) at fold time.
const ADJUDICATE_SCHEMA = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["criteriaId", "verdict"],
        properties: {
          criteriaId: { type: "string" },
          verdict: { enum: ["C", "NC", "NA", "manual"] },
          justification: { type: "string", description: "REQUIRED for C and NA" },
          // REQUIRED by the fold alongside `justification`, for exactly the same reason
          // `normativeRef` is required on an NC: a cleared criterion has to name what it
          // cleared. Omitting it here (and from the adjudicator contract) made every
          // adjudication produce C/NA verdicts that `verify --apply` then refused wholesale —
          // 63 rejections out of 97 verdicts on the run that surfaced this.
          citations: {
            type: "array",
            description:
              "REQUIRED for C, and for NA when evidence was presented: the evidence items you cleared, `file`/`line` copied verbatim from this criterion's own evidence[]",
            items: {
              type: "object",
              required: ["file", "line"],
              properties: { file: { type: "string" }, line: { type: "number" }, selector: { type: "string" }, snippet: { type: "string" } },
            },
          },
          reason: { type: ["string", "null"], enum: ["needs-rendered-dom", "undecidable", null], description: "REQUIRED for a still-manual verdict" },
          findings: {
            type: "array",
            description: "REQUIRED (>=1, groundable) for NC",
            items: {
              type: "object",
              // `normativeRef` is REQUIRED by the fold (src/adjudicate.ts): an NC with none is
              // rejected. Omitting it here made every fan-out adjudication produce NC verdicts
              // that `verify --apply` then refused.
              required: ["file", "line", "message", "normativeRef"],
              properties: {
                file: { type: "string" },
                line: { type: "integer" },
                selector: { type: "string" },
                message: { type: "string" },
                snippet: { type: "string" },
                severity: { enum: ["bloquant", "majeur", "mineur"] },
                normativeRef: {
                  type: "string",
                  description:
                    "The precise failed test of the ACTIVE standard. WCAG core: a success-criterion id (e.g. '1.1.1'). Country standard: a test OF THIS ITEM'S OWN CRITERION (e.g. '11.2.1' on item 11.2) — a WCAG id looks alike but denotes an unrelated test and is rejected.",
                },
              },
            },
          },
        },
      },
    },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["n", "verdict", "note"],
        properties: {
          n: { type: "integer" },
          verdict: { enum: ["supported", "partial", "refuted", "unsupported"] },
          note: { type: "string", description: "one line grounded in the source you read" },
        },
      },
    },
  },
};

interface PhaseSpec {
  role: string;
  title: string;
  schema: unknown;
  description: (items: number) => string;
  /** The orchestrator's fold step, shown as a comment in the workflow tail + in the runbook. */
  applyHint: (engineAbs: string, worklist: string, runAbs: string) => string;
}

const PHASE_SPECS: Record<string, PhaseSpec> = {
  adjudicate: {
    role: "adjudicator",
    title: "Adjudicate",
    schema: ADJUDICATE_SCHEMA,
    description: (n) => `Adjudicate the ${n} residual judgment criterion(ia) of an ultra11y audit (fan-out, fail-closed fold)`,
    applyHint: (engine, worklist, run) => `node ${engine} verify --apply ${worklist} --in ${join(run, "audit-latest.json")} --out ${run}`,
  },
  "verify-report": {
    role: "refuter",
    title: "Verify",
    schema: VERIFY_SCHEMA,
    description: (n) => `Adversarially verify the ${n} non-conformity claim(s) of an ultra11y report (skeptic fan-out)`,
    applyHint: (engine, worklist) => `node ${engine} verify --apply ${worklist} --report <report.md>`,
  },
};

export function phaseSpec(name: string): PhaseSpec {
  const spec = PHASE_SPECS[name];
  if (!spec) throw new Error(`no phase spec for "${name}"`);
  return spec;
}

/** Chunk worklist ids into batches, one subagent per batch (order-preserving, deterministic). */
export function toBatches(ids: string[], batchSize: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) out.push(ids.slice(i, i + batchSize));
  return out;
}

export function phaseWorkflowScript(ph: PhaseInfo, runAbs: string, engineAbs: string, batchSize: number): string {
  const spec = phaseSpec(ph.name);
  const scriptPath = join(runAbs, "orchestration", `${ph.name}.workflow.mjs`);
  const meta = { name: `ultra11y-${ph.name}`, description: spec.description(ph.items), phases: [{ title: spec.title }] };
  return [
    `export const meta = ${JSON.stringify(meta)}`,
    ``,
    `// NOT a plain Node script: launch via the Workflow tool — Workflow({ scriptPath: ${JSON.stringify(scriptPath)} }).`,
    `// Emitted by \`ultra11y orchestrate\` from the CURRENT worklist. The worklist is the source`,
    `// of truth: if it changes, re-run \`orchestrate --phase ${ph.name}\` before launching.`,
    ``,
    `// Constants for THIS run (injected at emit time; no Date.now/Math.random in this harness).`,
    `const RUN = ${JSON.stringify(runAbs)}`,
    `const ENGINE = ${JSON.stringify(engineAbs)}`,
    `const WORKLIST = ${JSON.stringify(ph.worklist)}`,
    `const AGENTS = RUN + '/orchestration/agents'`,
    `const BATCHES = ${JSON.stringify(toBatches(ph.ids, batchSize))}`,
    `const SCHEMA = ${JSON.stringify(spec.schema)}`,
    ``,
    `function contract(name, extra) {`,
    `  return 'Read and follow the dispatch contract at ' + AGENTS + '/' + name + '.md VERBATIM.\\n'`,
    `    + 'Constants: RUN=' + RUN + '  ENGINE=' + ENGINE + '  WORKLIST=' + WORKLIST + '.\\n'`,
    `    + 'Invoke the engine only by its ABSOLUTE path: node ' + ENGINE + ' <cmd> — read-only commands only.'`,
    `    + (extra ? '\\n' + extra : '')`,
    `}`,
    ``,
    `log('ultra11y ${ph.name}: ' + ${JSON.stringify(String(ph.items))} + ' item(s) across ' + BATCHES.length + ' agent(s)')`,
    ``,
    `phase(${JSON.stringify(spec.title)})`,
    `const results = await pipeline(BATCHES, (batch, _item, i) =>`,
    `  agent(contract('${spec.role}', 'ITEMS=' + batch.join(',')), { label: '${ph.name}:' + (i + 1), phase: ${JSON.stringify(spec.title)}, agentType: 'general-purpose', schema: SCHEMA }))`,
    ``,
    `// One-writer rule: this workflow only COLLECTS verdict fragments. The main agent folds`,
    `// them into WORKLIST (fill each item's fields from the matching fragment), then runs:`,
    `//   ${spec.applyHint(engineAbs, ph.worklist, runAbs)}`,
    `return { phase: ${JSON.stringify(ph.name)}, worklist: WORKLIST, results: results.filter(Boolean) }`,
    ``,
  ].join("\n");
}

/** ECO IS A DIFFERENT HARNESS, AND THE CONTRACT HAS TO SAY SO.
 *
 *  The fan-out contract addresses a subagent spawned by a Workflow tool: it is handed
 *  `ITEMS=<id,…>`, it reads the full `ADJUDICATE.todo.json`, and it RETURNS a structured object
 *  the orchestrator folds. None of that exists on the `--eco` path, which is the one CI takes:
 *  there the adjudicator has Read/Grep/Glob/Edit/Write and no shell, it is told NOT to open
 *  `ADJUDICATE.todo.json` (half a megabyte), it reads one `adjudicate/<id>.md` per criterion,
 *  and its only output is an EDIT of `ADJUDICATE.verdicts.json`.
 *
 *  Emitting the fan-out contract there and then telling the agent to obey it VERBATIM — which
 *  is what the composite action's prompt says — hands a small model two sets of instructions
 *  that contradict each other on the file to read, the file to write, the item selection and
 *  the output channel. Measured on run 32385981037 (Haiku, RGAA, 3 passes): 3 of 41 criteria
 *  came back with no verdict at all. So `--eco` gets a contract written for the harness it
 *  actually runs in. */

/** THE RULING RULES ARE THE SAME IN EVERY HARNESS — only the paperwork differs.
 *
 *  Kept as one string and shared by both eco contracts below, so the fan-out contract and the
 *  sequential one can never drift into two different definitions of what a `C` requires. */
const VERDICT_RULES = `2. Rule it (the apply gate is FAIL-CLOSED — a verdict missing its required field does not fold, and its criterion goes back to « to assess » carrying the refusal):
   - \`C\` (conforming) — REQUIRES \`justification\` explaining why the evidence satisfies the criterion, AND \`citations[]\` naming the evidence you cleared (\`file\`/\`line\` copied VERBATIM from this criterion's own evidence; an anchor that is not in that list is treated as fabricated). A criterion presented with NO evidence at all cannot be \`C\` — it is \`manual\` (\`undecidable\`), or \`NA\` if nothing in scope is concerned.
   - \`NC\` (non-conforming) — REQUIRES \`findings\`: at least one groundable \`{ file, line, selector?, message, snippet?, severity?, normativeRef }\` pointing at REAL source. The fold re-grounds every finding; an invented file:line is rejected, and so is a finding with no \`file\` at all. \`normativeRef\` MUST cite the precise failed test — under a country standard, one of the criterion's OWN numbered tests, listed in its brief under « tests to rule on ». A WCAG id looks alike, denotes an unrelated test, and is rejected.
   - \`NA\` (not applicable) — REQUIRES \`justification\`, AND \`citations[]\` whenever evidence WAS presented, to say which of those items fall outside the criterion's scope.
   - \`manual\` (still undecidable) — REQUIRES \`reason\`: \`needs-rendered-dom\` (only a rendered DOM can decide it, and no capture in this run carries its subject) or \`undecidable\` (the evidence cannot settle it either way).
3. AN NC SHAPED LIKE AN ABSENCE IS STILL ANCHORED. « No second navigation system », « no search engine », « no error message suggests the expected format » — an absence is OBSERVED somewhere: cite the element and the page you observed it on. And when the criterion's subject exists nowhere in the audited scope, the verdict is \`NA\` with its justification, never \`NC\`.
4. THE RENDERED PAGE MAY BE ON DISK. When a criterion's evidence is anchored under \`.ultra11y/pages/<id>/\`, the browser already ran: \`dom.html\`, \`styles.json\`, \`boxes.json\`, \`axtree.json\` and \`screen.png\` are there to read. \`needs-rendered-dom\` is refused on such a criterion — decide it from those files, or answer \`undecidable\` and say what the capture does not settle.
5. Never guess. A criterion you cannot decide from real evidence stays \`manual\` with its reason — that is a valid, honest verdict, and it is worth more than a verdict the gate throws away.`;

/** The sequential adjudicator — `--eco`, no fan-out.
 *
 *  Two shapes, because eco covers two harnesses and the difference is only WHICH FILE. A local
 *  session has a shell and edits the big worklist; a CI adjudicator has Read/Grep/Glob/Edit/Write
 *  and works from the split surface `writeAdjudication` always emits beside it. Both are named,
 *  and the caller's prompt decides — which is the sentence that stops a model obeying this
 *  document into a file it was just told not to open. */
function ecoAdjudicatorContract(runAbs: string): string {
  return `# Contract: adjudicator (sequential / --eco)

You adjudicate the residual judgment criteria of an ultra11y audit — the ones the deterministic engine could not decide (alt-text relevance, link purpose in context, reading order…). The ACTIVE STANDARD is recorded in the worklist's \`standard\` field: under a country standard (e.g. \`rgaa\`) the items are that standard's OWN criteria, each carrying its numbered tests — not WCAG success criteria.

There is no fan-out here and no ITEMS selection: you handle EVERY criterion, one at a time, in order.

## Which files — your prompt decides, and it wins over this document

- **With a shell.** Read \`${join(runAbs, "ADJUDICATE.todo.json")}\`, fill each item's verdict in place, then fold: \`ultra11y verify --apply ${join(runAbs, "ADJUDICATE.todo.json")} --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\`. Each criterion's brief cites the standard's official page for it; if a wording stays ambiguous and you have a web tool, you MAY read that page to settle it — never to contradict the vendored text, and a web page is never a \`normativeRef\`.
- **Without a shell** (CI: Read, Grep, Glob, Edit, Write only). Do NOT open \`ADJUDICATE.todo.json\` or \`ADJUDICATE.md\` — they run to hundreds of kilobytes and will swamp your context. Read \`${join(runAbs, "adjudicate")}/<criteriaId>.md\`, one small brief per criterion carrying its evidence, its decision protocol, its numbered tests and this contract in short form. Write your verdicts into \`${join(runAbs, "ADJUDICATE.verdicts.json")}\` — the ONLY file you write. Someone else folds; you never run the engine.

## For EACH criterion

1. Read its brief in full — it carries BOTH halves of the decision: the criterion's official wording with its numbered tests, the standard's own test methodology, the technical note, the particular cases and the glossary terms; and \`evidence[]\`, source-anchored excerpts (\`file\`, \`line\`, \`selector\`, \`snippet\`). Open the cited files at the cited lines whenever the snippet alone cannot decide, and copy the \`snippet\` from the brief rather than retyping it.
${VERDICT_RULES}

Every item comes back with a verdict. Each one stands or falls on its own: a refusal costs THAT criterion and leaves every other verdict standing — so work through the list steadily, and never guess to fill a gap.

Do not edit any other file, do not touch the audited source, do not commit, and do not comment on any pull request.
`;
}

/** The sequential refuter — same removals: no ITEMS, no structured output, no orchestrator. */
function ecoRefuterContract(runAbs: string): string {
  return `# Contract: refuter (sequential / --eco)

You are an adversarial skeptic verifying the non-conformities of an ultra11y report. Your job is to try to REFUTE each claim: assume it is wrong until the source proves it.

There is no fan-out here and no ITEMS selection: you handle EVERY entry of \`${join(runAbs, "VERIFY.todo.json")}\` (a JSON array; each entry has \`n\`, \`criteriaId\`, \`file\`, \`line\`, \`selector\`, \`claim\`), one at a time, writing your verdict into that same file.

For EACH entry:

1. Open \`file\` at \`line\` and read the cited element (\`selector\`) in its real context.
2. Judge the claim against the source:
   - \`supported\` — the cited code violates the criterion exactly as claimed.
   - \`partial\` — a real issue, but the claim overstates it (wrong element, wrong scope, exaggerated count).
   - \`unsupported\` — the source does not establish the claim.
   - \`refuted\` — the source contradicts the claim.
   When unsure, choose the HARSHER verdict — a false pass is worse than a false fail.
3. \`note\` is REQUIRED — one line grounded in what you read (quote or paraphrase the decisive code).

Then fold: \`ultra11y verify --apply ${join(runAbs, "VERIFY.todo.json")} --report <the report .md>\`. Without a shell, leave the fold to whoever gave you the file.
`;
}

export function agentContracts(runAbs: string, engineAbs: string, opts: { eco?: boolean } = {}): Record<string, string> {
  const footer = ONE_WRITER_FOOTER.replaceAll("<RUN>", runAbs);
  if (opts.eco) return { adjudicator: ecoAdjudicatorContract(runAbs), refuter: ecoRefuterContract(runAbs) };
  return {
    adjudicator: `# Contract: adjudicator

You adjudicate the residual judgment criteria of an ultra11y audit — the ones the deterministic engine could not decide (alt-text relevance, link purpose in context, reading order…). The ACTIVE STANDARD is recorded in the worklist's \`standard\` field: under a country standard (e.g. \`rgaa\`) the items are that standard's OWN criteria, each carrying its numbered tests — not WCAG success criteria.

Worklist: \`${join(runAbs, "ADJUDICATE.todo.json")}\` (an object with \`kind: "adjudication"\` and \`items[]\`). Handle ONLY the criteria whose \`criteriaId\` is named in your prompt (\`ITEMS=<id,…>\`).

For EACH of your criteria:

1. Read its worklist entry for the EVIDENCE: \`evidence[]\` holds source-anchored excerpts (\`file\`, \`line\`, \`selector\`, \`snippet\`) harvested from the audited code — open the cited files at the cited lines whenever the snippet alone cannot decide.
1b. Read \`${join(runAbs, "adjudicate")}/<criteriaId>.md\` for the CRITERION ITSELF — its official wording, its numbered tests with the standard's own test methodology, the technical note, the particular cases and the glossary terms the tests are defined in terms of. The worklist JSON carries none of that: it holds the evidence and the slots your verdict goes into, and ruling on a country standard from the criterion's title alone is how a verdict ends up citing a test it never read. That brief also cites the standard's official page for the criterion: if a wording stays ambiguous and you have a web tool, you MAY read that page to settle it — never to contradict the vendored text, and a web page is never a \`normativeRef\`.
2. Rule it (the apply gate is FAIL-CLOSED — a verdict missing its required field does not fold):
   - \`C\` (conforming) — REQUIRES \`justification\` explaining why the evidence satisfies the criterion, AND \`citations[]\` naming the evidence you cleared (\`file\`/\`line\` copied VERBATIM from this item's own \`evidence[]\`; an anchor that is not in that list is treated as fabricated). A criterion whose \`evidence[]\` is empty cannot be \`C\` at all — it is \`manual\` (\`undecidable\`), or \`NA\` if nothing in scope is concerned.
   - \`NC\` (non-conforming) — REQUIRES \`findings\`: at least one groundable \`{ file, line, selector?, message, snippet?, severity?, normativeRef }\` pointing at REAL source. The fold re-grounds every finding; an invented file:line is rejected. \`normativeRef\` MUST cite the precise failed test — under a country standard, one of the item's OWN tests, which its brief lists for you under « tests to rule on ». A WCAG id looks alike, denotes an unrelated test, and is rejected.
   - \`NA\` (not applicable) — REQUIRES \`justification\`, AND \`citations[]\` whenever evidence WAS presented, to say which of those items fall outside the criterion's scope.
   - \`manual\` (still undecidable) — REQUIRES \`reason\`: \`needs-rendered-dom\` (only a rendered DOM can decide, e.g. computed contrast) or \`undecidable\` (the evidence cannot settle it either way).
3. Never guess. A criterion you cannot decide from real evidence stays \`manual\` with a reason — that is a valid, honest verdict; the scan tier or a human picks it up.

Return (structured output): \`{ "verdicts": [{ "criteriaId", "verdict", "justification", "citations", "reason", "findings" }] }\` — your ITEMS only, every field grounded in what you actually read, every NC finding carrying its \`normativeRef\`, and every C (plus every evidenced NA) carrying its \`citations\`. A verdict that clears a criterion without naming what it cleared is refused by the fold; the refusal costs THAT criterion — which stays « to assess » carrying the reason — and leaves every other verdict standing. So never guess to fill a gap: an honest \`manual\` is worth more than a verdict the gate throws away.
${footer}`,
    refuter: `# Contract: refuter

You are an adversarial skeptic verifying the non-conformities of an ultra11y report. Your job is to try to REFUTE each claim: assume it is wrong until the source proves it.

Worklist: \`${join(runAbs, "VERIFY.todo.json")}\` (a JSON array; each entry has \`n\`, \`criteriaId\`, \`file\`, \`line\`, \`selector\`, \`claim\`). Handle ONLY the entries whose \`n\` is named in your prompt (\`ITEMS=<n,…>\`).

For EACH of your entries:

1. Open \`file\` at \`line\` and read the cited element (\`selector\`) in its real context.
2. Judge the claim against the source:
   - \`supported\` — the cited code violates the criterion exactly as claimed.
   - \`partial\` — a real issue, but the claim overstates it (wrong element, wrong scope, exaggerated count).
   - \`unsupported\` — the source does not establish the claim.
   - \`refuted\` — the source contradicts the claim.
   When unsure, choose the HARSHER verdict — a false pass is worse than a false fail.
3. \`note\` is REQUIRED — one line grounded in what you read (quote or paraphrase the decisive code).

Return (structured output): \`{ "verdicts": [{ "n", "verdict", "note" }] }\` — your ITEMS only.
${footer}`,
  };
}

export function runbookMd(phases: PhaseInfo[], runAbs: string, engineAbs: string, unrendered: string[] = []): string {
  const status = phases
    .map((p) => `| ${p.name} | \`${p.worklist}\` | ${p.ready ? `ready (${p.items} item(s))` : "not ready"} | \`${p.prerequisite}\` |`)
    .join("\n");
  const engine = `node ${engineAbs}`;
  // RENDER FIRST, WHEN NOTHING HAS BEEN RENDERED — at the top, above the phase table, because
  // it is the one step that changes what every phase below costs. Measured on a real cascade:
  // 80 criteria to adjudicate from source alone, 41 once one page was scanned. Three passes and
  // $24.90 were spent discovering that the seven left over needed a browser nobody had run.
  const renderFirst = unrendered.length
    ? `
> ⚠️ **Render before you adjudicate.** ${unrendered.length} criterion(ia) in this run need a rendered page and
> nothing has been snapshotted: no reading of the source can settle them, and every pass over them
> costs a model and returns \`needs-rendered-dom\`. Run the scan first — it decides most of them with
> no model in the loop — then re-emit this runbook:
>
> \`\`\`
> ${engine} scan <url> --runtime local --merge ${join(runAbs, "audit-latest.json")} --out ${runAbs}
> ${engine} verify --manual --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}
> ${engine} orchestrate --run ${runAbs}
> \`\`\`
>
> Concerned: ${unrendered.map((id) => `\`${id}\``).join(" · ")}
`
    : "";
  return `# ultra11y — sequential RUNBOOK (eco / no-subagent fallback)

Run: \`${runAbs}\` · Engine: \`${engine}\`
${renderFirst}
Generated by \`ultra11y orchestrate\` from the CURRENT run state. This sequential path is
correctness-identical to the multi-agent workflows — same worklists, same contracts, same
fail-closed gates; only wall-clock differs. Fan-out is an optimization, not a requirement.

## Phase status

| Phase | Worklist | Status | Produce it with |
|---|---|---|---|
${status}

## The loop (play every role yourself, one item at a time)

1. **Audit** (if not done): \`${engine} audit "<globs>" --graph --out ${runAbs}\` → \`${join(runAbs, "audit-latest.json")}\`.
2. **Adjudicate the residual criteria** — \`${engine} verify --manual --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\` writes \`${join(runAbs, "ADJUDICATE.todo.json")}\`. For EVERY item, apply \`${join(runAbs, "orchestration", "agents", "adjudicator.md")}\` yourself (read the evidence, rule C/NC/NA/manual, fill the required justification/findings/reason IN the todo file). Then fold — gated per verdict, so a refusal costs its own criterion and no other: \`${engine} verify --apply ${join(runAbs, "ADJUDICATE.todo.json")} --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\`. Add \`--ledger .ultra11y/verdicts/<standard>.json\` to RECORD the verdicts that landed, so CI can replay them without a model; \`--strict\` restores the old all-or-nothing fold.
3. **Report**: \`${engine} report --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\`.
4. **Verify the report's claims** — \`${engine} verify --report <the report .md> --out ${runAbs}\` writes \`${join(runAbs, "VERIFY.todo.json")}\`. For EVERY entry, apply \`${join(runAbs, "orchestration", "agents", "refuter.md")}\` yourself (open file:line, verdict supported/partial/refuted/unsupported + note IN the todo file). Then: \`${engine} verify --apply ${join(runAbs, "VERIFY.todo.json")} --report <the report .md>\`.
5. **Gate**: \`${engine} check --report <the report .md> --semantic\` must exit 0 before presenting anything.
6. **Fix & re-audit**: \`${engine} fix <globs> --write --iterate\`, hand-apply the judgment fixes, then loop from step 1 until the gate stays green.

With subagents available, prefer the emitted workflows instead: \`orchestrate --run ${runAbs} --phase <p>\` then \`Workflow({ scriptPath: "${join(runAbs, "orchestration", "<p>.workflow.mjs")}" })\` — you stay the sole writer either way.
`;
}
