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

export function agentContracts(runAbs: string, engineAbs: string): Record<string, string> {
  const footer = ONE_WRITER_FOOTER.replaceAll("<RUN>", runAbs);
  return {
    adjudicator: `# Contract: adjudicator

You adjudicate the residual judgment criteria of an ultra11y audit — the ones the deterministic engine could not decide (alt-text relevance, link purpose in context, reading order…). The ACTIVE STANDARD is recorded in the worklist's \`standard\` field: under a country standard (e.g. \`rgaa\`) the items are that standard's OWN criteria, each carrying its numbered tests — not WCAG success criteria.

Worklist: \`${join(runAbs, "ADJUDICATE.todo.json")}\` (an object with \`kind: "adjudication"\` and \`items[]\`). Handle ONLY the criteria whose \`criteriaId\` is named in your prompt (\`ITEMS=<id,…>\`).

For EACH of your criteria:

1. Read its worklist entry. \`evidence[]\` holds source-anchored excerpts (\`file\`, \`line\`, \`selector\`, \`snippet\`) harvested from the audited code — open the cited files at the cited lines whenever the snippet alone cannot decide.
2. Rule it (the apply gate is FAIL-CLOSED — a verdict missing its required field does not fold):
   - \`C\` (conforming) — REQUIRES \`justification\` explaining why the evidence satisfies the criterion.
   - \`NC\` (non-conforming) — REQUIRES \`findings\`: at least one groundable \`{ file, line, selector?, message, snippet?, severity?, normativeRef }\` pointing at REAL source. The fold re-grounds every finding; an invented file:line is rejected. \`normativeRef\` MUST cite the precise failed test — under a country standard, one of the item's OWN tests, which the worklist lists for you under « tests to rule on ».
   - \`NA\` (not applicable) — REQUIRES \`justification\`.
   - \`manual\` (still undecidable) — REQUIRES \`reason\`: \`needs-rendered-dom\` (only a rendered DOM can decide, e.g. computed contrast) or \`undecidable\` (the evidence cannot settle it either way).
3. Never guess. A criterion you cannot decide from real evidence stays \`manual\` with a reason — that is a valid, honest verdict; the scan tier or a human picks it up.

Return (structured output): \`{ "verdicts": [{ "criteriaId", "verdict", "justification", "reason", "findings" }] }\` — your ITEMS only, every field grounded in what you actually read, every NC finding carrying its \`normativeRef\`.
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

export function runbookMd(phases: PhaseInfo[], runAbs: string, engineAbs: string): string {
  const status = phases
    .map((p) => `| ${p.name} | \`${p.worklist}\` | ${p.ready ? `ready (${p.items} item(s))` : "not ready"} | \`${p.prerequisite}\` |`)
    .join("\n");
  const engine = `node ${engineAbs}`;
  return `# ultra11y — sequential RUNBOOK (eco / no-subagent fallback)

Run: \`${runAbs}\` · Engine: \`${engine}\`

Generated by \`ultra11y orchestrate\` from the CURRENT run state. This sequential path is
correctness-identical to the multi-agent workflows — same worklists, same contracts, same
fail-closed gates; only wall-clock differs. Fan-out is an optimization, not a requirement.

## Phase status

| Phase | Worklist | Status | Produce it with |
|---|---|---|---|
${status}

## The loop (play every role yourself, one item at a time)

1. **Audit** (if not done): \`${engine} audit "<globs>" --graph --out ${runAbs}\` → \`${join(runAbs, "audit-latest.json")}\`.
2. **Adjudicate the residual criteria** — \`${engine} verify --manual --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\` writes \`${join(runAbs, "ADJUDICATE.todo.json")}\`. For EVERY item, apply \`${join(runAbs, "orchestration", "agents", "adjudicator.md")}\` yourself (read the evidence, rule C/NC/NA/manual, fill the required justification/findings/reason IN the todo file). Then fold, fail-closed: \`${engine} verify --apply ${join(runAbs, "ADJUDICATE.todo.json")} --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\`.
3. **Report**: \`${engine} report --in ${join(runAbs, "audit-latest.json")} --out ${runAbs}\`.
4. **Verify the report's claims** — \`${engine} verify --report <the report .md> --out ${runAbs}\` writes \`${join(runAbs, "VERIFY.todo.json")}\`. For EVERY entry, apply \`${join(runAbs, "orchestration", "agents", "refuter.md")}\` yourself (open file:line, verdict supported/partial/refuted/unsupported + note IN the todo file). Then: \`${engine} verify --apply ${join(runAbs, "VERIFY.todo.json")} --report <the report .md>\`.
5. **Gate**: \`${engine} check --report <the report .md> --semantic\` must exit 0 before presenting anything.
6. **Fix & re-audit**: \`${engine} fix <globs> --write --iterate\`, hand-apply the judgment fixes, then loop from step 1 until the gate stays green.

With subagents available, prefer the emitted workflows instead: \`orchestrate --run ${runAbs} --phase <p>\` then \`Workflow({ scriptPath: "${join(runAbs, "orchestration", "<p>.workflow.mjs")}" })\` — you stay the sole writer either way.
`;
}
