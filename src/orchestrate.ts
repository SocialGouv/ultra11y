import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { unrenderedResidual, type AdjudicationFile, type AdjudicationItem } from "./adjudicate.js";
import type { AuditResult } from "./types.js";
import { agentContracts, phaseSpec, phaseWorkflowScript, runbookMd, toBatches } from "./orchestrate-templates.js";
import { readVerifyContext, type VerifyItem } from "./verify.js";

// ---------------------------------------------------------------------------
// `ultra11y orchestrate` — emit the run's multi-agent orchestration from its
// CURRENT worklists (per-phase workflow scripts + dispatch contracts + a
// sequential RUNBOOK), so a subagent-capable harness fans the judgment work
// out while the main agent stays the sole writer. Per-phase emission is
// deliberate: each worklist only exists after its engine step (`verify
// --manual`, `verify --report`), so a whole-pipeline script could only carry
// placeholders — exactly what the check/verify gates exist to prevent.
// ---------------------------------------------------------------------------

export const PHASES = ["adjudicate", "verify-report"] as const;
export type PhaseName = (typeof PHASES)[number];

/** Small worklists don't amortize a fan-out — orchestrate says so and nudges --eco. */
export const SMALL_WORKLIST = 3;
/** One subagent per batch of at most this many worklist items. */
export const BATCH_SIZE = 8;

export interface PhaseInfo {
  name: PhaseName;
  ready: boolean;
  /** Absolute path of the worklist this phase fans out over. */
  worklist: string;
  items: number;
  /** The injected fan-out ids (criteriaId for adjudicate, `n` for verify-report). */
  ids: string[];
  /** The engine command that produces the worklist when it is missing. */
  prerequisite: string;
  /** The engine command that folds the filled worklist back — built from the SAME run context
   *  as `prerequisite`, so the list and its apply always try the same claims (#59). */
  apply: string;
}

/** The run's active standard, best effort: the context the verify list was generated with, the
 *  adjudication worklist, then the audit itself. Undefined when the run says nothing yet. */
function runStandard(run: string): string | undefined {
  const ctx = readVerifyContext(run);
  if (ctx?.standard) return ctx.standard;
  for (const f of ["ADJUDICATE.todo.json", "audit-latest.json"]) {
    try {
      const std = (JSON.parse(readFileSync(join(run, f), "utf8")) as { standard?: unknown }).standard;
      if (typeof std === "string" && std) return std;
    } catch {
      /* not there yet */
    }
  }
  return undefined;
}

/** THE ONE CONTEXT THE VERIFY-REPORT PHASE RUNS IN (#59): the run's audit, its standard, and
 *  whatever explicit conformity source the list was generated with. Every command the phase
 *  emits — generation, apply, the contracts' fold line, the semantic gate — is built from it.
 *  Without it the RUNBOOK generated `verify --report <md>` alone: in a directory with no ledger
 *  that list tried the engine's NCs and silently skipped every adjudicated conformity.
 *
 *  `report` is the report the list was generated from once there is one (recorded beside it),
 *  the `<report.md>` placeholder before. `flags` holds no engine path, so the contracts — which
 *  name the engine through the injected `ENGINE` constant — can reuse it verbatim. */
export function verifyRunContext(runDir: string): { report: string; flags: string; flagArgs: string[]; standard?: string } {
  const run = resolve(runDir);
  const ctx = readVerifyContext(run);
  const standard = runStandard(run);
  const flagArgs = ["--in", ctx?.in ?? join(run, "audit-latest.json")];
  if (standard) flagArgs.push("--standard", standard);
  if (ctx?.conformities.source === "file") flagArgs.push("--conformities", ctx.conformities.path);
  if (ctx?.conformities.source === "disabled") flagArgs.push("--no-conformities");
  return {
    report: ctx && ctx.report !== "-" ? ctx.report : REPORT_PLACEHOLDER,
    flags: flagArgs.join(" "),
    flagArgs,
    ...(standard ? { standard } : {}),
  };
}

/** Tokens a caller substitutes before running a step: they name inputs only the caller knows. */
export const GLOBS_PLACEHOLDER = "<globs>";
export const REPORT_PLACEHOLDER = "<report.md>";

export type EngineStepId = "audit" | "adjudicate-worklist" | "adjudicate-fold" | "report" | "verify-worklist" | "verify-fold" | "gate" | "fix";

/** EVERY ENGINE COMMAND OF THE LOOP, BUILT ONCE (#82) — as argv after `node <engine>`. The
 *  phase table, the manifest and (through the manifest) the RUNBOOK and the workflow's fold
 *  comment all render from here, so no two of them can ever disagree on a flag. */
function engineArgs(run: string): Record<EngineStepId, string[]> {
  const audit = join(run, "audit-latest.json");
  const v = verifyRunContext(run);
  return {
    audit: ["audit", GLOBS_PLACEHOLDER, "--graph", "--out", run],
    "adjudicate-worklist": ["verify", "--manual", "--in", audit, "--out", run],
    "adjudicate-fold": ["verify", "--apply", join(run, "ADJUDICATE.todo.json"), "--in", audit, "--out", run],
    report: ["report", "--in", audit, "--out", run],
    "verify-worklist": ["verify", "--report", v.report, ...v.flagArgs, "--out", run],
    "verify-fold": ["verify", "--apply", join(run, "VERIFY.todo.json"), "--report", v.report, ...v.flagArgs],
    gate: ["check", "--report", v.report, ...(v.standard ? ["--standard", v.standard] : []), "--semantic", "--verdicts", join(run, "VERIFY.todo.json")],
    fix: ["fix", GLOBS_PLACEHOLDER, "--write", "--iterate"],
  };
}

/** One shell line for an engine step. The glob placeholder is quoted: the shell must not expand it. */
export function renderCommand(engineAbs: string, args: string[]): string {
  return `node ${engineAbs} ${args.map((a) => (a === GLOBS_PLACEHOLDER ? `"${a}"` : a)).join(" ")}`;
}

export function listPhases(runDir: string, engineAbs: string): PhaseInfo[] {
  const run = resolve(runDir);

  const adjPath = join(run, "ADJUDICATE.todo.json");
  let adjIds: string[] = [];
  let adjReady = false;
  if (existsSync(adjPath)) {
    try {
      const f = JSON.parse(readFileSync(adjPath, "utf8")) as AdjudicationFile;
      if (f && f.kind === "adjudication" && Array.isArray(f.items)) {
        adjReady = true;
        adjIds = f.items.map((i) => i.criteriaId);
      }
    } catch {
      /* unreadable worklist = not ready */
    }
  }

  const verPath = join(run, "VERIFY.todo.json");
  let verIds: string[] = [];
  let verReady = false;
  if (existsSync(verPath)) {
    try {
      const items = JSON.parse(readFileSync(verPath, "utf8")) as VerifyItem[];
      if (Array.isArray(items)) {
        verReady = true;
        verIds = items.map((i) => String(i.n));
      }
    } catch {
      /* unreadable worklist = not ready */
    }
  }

  const args = engineArgs(run);
  return [
    {
      name: "adjudicate",
      ready: adjReady,
      worklist: adjPath,
      items: adjIds.length,
      ids: adjIds,
      prerequisite: renderCommand(engineAbs, args["adjudicate-worklist"]),
      apply: renderCommand(engineAbs, args["adjudicate-fold"]),
    },
    {
      name: "verify-report",
      ready: verReady,
      worklist: verPath,
      items: verIds.length,
      ids: verIds,
      prerequisite: renderCommand(engineAbs, args["verify-worklist"]),
      apply: renderCommand(engineAbs, args["verify-fold"]),
    },
  ];
}

/** One step of the loop, as data (#82). An `engine` step is a command with an exit-code
 *  contract; a `judgment` step is the model's work: a role, its contract, the worklist it fills
 *  and the batches a fan-out dispatches. */
export interface ManifestStep {
  id: string;
  kind: "engine" | "judgment";
  title: string;
  /** Engine steps: the shell line, and the same as argv (`["node", <engine>, …]`). */
  command?: string;
  argv?: string[];
  /** Files (or placeholders) the step reads, and the files it writes. */
  inputs: string[];
  outputs: string[];
  /** Engine steps: what each exit code means for the caller. */
  exit?: Record<string, string>;
  /** Judgment steps. */
  role?: "adjudicator" | "refuter";
  contract?: string;
  worklist?: string;
  items?: number;
  batches?: string[][];
  /** The structured fragment one batch returns (fan-out); the sequential path fills the worklist in place. */
  schema?: unknown;
  /** Every input that is a real file exists now (placeholders are the caller's to substitute). */
  ready: boolean;
  /** The step that comes next, or null at the end of the loop. */
  next: string | null;
  /** Where to go when this step exits non-zero, when that is not simply « stop ». */
  onFailure?: string;
}

export interface OrchestrationManifest {
  kind: "ultra11y-orchestration-manifest";
  schemaVersion: 1;
  run: string;
  engine: string;
  standard?: string;
  placeholders: Array<{ token: string; meaning: string }>;
  phases: PhaseInfo[];
  steps: ManifestStep[];
}

const EXIT_USAGE = "usage / bad input (missing or unreadable file, unknown flag value)";

/** THE ADJUDICATION LOOP AS DATA (#82) — what an orchestrator that is not Claude Code (a bot, a
 *  CI job, another agent harness) drives instead of re-deriving the graph from the prose. The
 *  RUNBOOK is rendered from it (`runbookMd`), so the data and the prose are one source. */
export function buildManifest(runDir: string, engineAbs: string, batchSize = BATCH_SIZE): OrchestrationManifest {
  const run = resolve(runDir);
  const args = engineArgs(run);
  const phases = listPhases(run, engineAbs);
  const v = verifyRunContext(run);
  const audit = join(run, "audit-latest.json");
  const adjTodo = join(run, "ADJUDICATE.todo.json");
  const verTodo = join(run, "VERIFY.todo.json");
  const placeholder = (f: string) => f === GLOBS_PLACEHOLDER || f === REPORT_PLACEHOLDER;
  const ready = (inputs: string[]) => inputs.every((f) => placeholder(f) || existsSync(f));
  const engine = (id: EngineStepId, title: string, inputs: string[], outputs: string[], exit: Record<string, string>, next: string | null): ManifestStep => ({
    id,
    kind: "engine",
    title,
    command: renderCommand(engineAbs, args[id]),
    argv: ["node", engineAbs, ...args[id]],
    inputs,
    outputs,
    exit,
    ready: ready(inputs),
    next,
  });
  const judgment = (id: string, ph: PhaseInfo, role: "adjudicator" | "refuter", title: string, inputs: string[], next: string): ManifestStep => ({
    id,
    kind: "judgment",
    title,
    role,
    contract: join(run, "orchestration", "agents", `${role}.md`),
    worklist: ph.worklist,
    items: ph.items,
    batches: toBatches(ph.ids, batchSize),
    schema: phaseSpec(ph.name).schema,
    inputs,
    outputs: [ph.worklist],
    ready: ph.ready && ph.items > 0,
    next,
  });
  const [adj, ver] = phases as [PhaseInfo, PhaseInfo];
  const verAudit = v.flagArgs[v.flagArgs.indexOf("--in") + 1]!;
  return {
    kind: "ultra11y-orchestration-manifest",
    schemaVersion: 1,
    run,
    engine: engineAbs,
    ...(v.standard ? { standard: v.standard } : {}),
    placeholders: [
      { token: GLOBS_PLACEHOLDER, meaning: "the files to audit — a glob the shell must not expand, or explicit paths" },
      { token: REPORT_PLACEHOLDER, meaning: `the Markdown report the \`report\` step writes into ${run} (<standard>-<date>.md)` },
    ].filter((p) => p.token === GLOBS_PLACEHOLDER || v.report === REPORT_PLACEHOLDER),
    phases,
    steps: [
      engine(
        "audit",
        "Audit — the deterministic finding set",
        [GLOBS_PLACEHOLDER],
        [audit],
        { "0": "audit written (no --fail-on, or clean)", "1": "findings at or above --fail-on", "2": EXIT_USAGE },
        "adjudicate-worklist",
      ),
      engine(
        "adjudicate-worklist",
        "Adjudication worklist — the criteria the engine could not decide",
        [audit],
        [adjTodo, join(run, "ADJUDICATE.md"), join(run, "ADJUDICATE.verdicts.json"), join(run, "adjudicate")],
        { "0": "worklist written (possibly empty: nothing to adjudicate)", "2": EXIT_USAGE },
        "adjudicate",
      ),
      judgment(
        "adjudicate",
        adj,
        "adjudicator",
        "Adjudicate — fill every item's verdict (C/NC/NA/manual)",
        [adjTodo, join(run, "adjudicate")],
        "adjudicate-fold",
      ),
      engine(
        "adjudicate-fold",
        "Fold — the fail-closed gate on the adjudication",
        [adjTodo, audit],
        [audit],
        {
          "0": "at least one verdict landed (refusals, if any, named in rejectedCriteria[] / issues[])",
          "1": "nothing landed, or --strict and a refusal",
          "2": EXIT_USAGE,
        },
        "report",
      ),
      engine(
        "report",
        "Report — deterministic rendering of the adjudicated audit",
        [audit],
        [REPORT_PLACEHOLDER],
        { "0": "report written", "2": EXIT_USAGE },
        "verify-worklist",
      ),
      engine(
        "verify-worklist",
        "Trial worklist — the report's non-conformities and the audit's claimed conformities",
        [v.report, verAudit],
        [verTodo, join(run, "VERIFY.md"), join(run, "VERIFY.context.json")],
        { "0": "worklist written", "2": EXIT_USAGE },
        "verify",
      ),
      judgment("verify", ver, "refuter", "Verify — rule every claim supported/partial/refuted/unsupported", [verTodo], "verify-fold"),
      engine(
        "verify-fold",
        "Apply the trial — coverage and grounding gate",
        [verTodo, v.report, verAudit],
        [],
        {
          "0": "every claim on trial supported or partial, and grounded in source",
          "1": "a claim refuted, unsupported, unadjudicated, missing or ungrounded",
          "2": EXIT_USAGE,
        },
        "gate",
      ),
      {
        ...engine(
          "gate",
          "Gate — structural and semantic check of the report",
          [v.report, verTodo],
          [],
          { "0": "report sound and semantic gate green — it may be presented", "1": "integrity or semantic failure — do not present it", "2": EXIT_USAGE },
          null,
        ),
        onFailure: "fix",
      },
      engine("fix", "Fix & re-audit — then loop", [GLOBS_PLACEHOLDER], [], { "0": "fixes applied (or nothing to fix)", "2": EXIT_USAGE }, "audit"),
    ],
  };
}

export interface OrchestrateOptions {
  /** Emit only this phase (exit 2 if its worklist does not exist yet). */
  phase?: string;
  /** Emit only the RUNBOOK + contracts (the explicit low-token sequential path). */
  eco?: boolean;
}

export interface OrchestrateResult {
  exitCode: number;
  written: string[];
  notices: string[];
  errors: string[];
  phases: PhaseInfo[];
}

/** The criteria this run cannot possibly decide, because it rendered nothing — read from the
 *  run directory's own two files.
 *
 *  BEST-EFFORT BY DESIGN. `orchestrate` emits a runbook; it is not a gate, and a run directory
 *  missing an audit or carrying a half-written worklist must still get its runbook. Anything
 *  unreadable answers "nothing to warn about" rather than failing the emission — the warning is
 *  a kindness, and a kindness that can break the tool is not one. */
function unrenderedInRun(run: string): string[] {
  try {
    const audit = JSON.parse(readFileSync(join(run, "audit-latest.json"), "utf8")) as AuditResult;
    const todo = JSON.parse(readFileSync(join(run, "ADJUDICATE.todo.json"), "utf8")) as { items?: AdjudicationItem[] };
    return unrenderedResidual(audit, todo.items ?? []);
  } catch {
    return [];
  }
}

export function orchestrateRun(runDir: string, engineAbs: string, opts: OrchestrateOptions = {}): OrchestrateResult {
  const run = resolve(runDir);
  if (!existsSync(run)) {
    return { exitCode: 2, written: [], notices: [], errors: [`run dir not found: ${run}`], phases: [] };
  }
  const phases = listPhases(run, engineAbs);

  let selected = phases.filter((p) => p.ready);
  if (opts.phase !== undefined) {
    const ph = phases.find((p) => p.name === opts.phase);
    if (!ph) {
      return {
        exitCode: 2,
        written: [],
        notices: [],
        errors: [`unknown phase "${opts.phase}" — expected one of: ${PHASES.join(", ")}.`],
        phases,
      };
    }
    if (!ph.ready) {
      return {
        exitCode: 2,
        written: [],
        notices: [],
        errors: [`phase "${ph.name}" is not ready — its worklist ${ph.worklist} does not exist yet. Produce it first: ${ph.prerequisite}`],
        phases,
      };
    }
    selected = [ph];
  }

  const orchDir = join(run, "orchestration");
  const agentsDir = join(orchDir, "agents");
  mkdirSync(join(orchDir, "out"), { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  const written: string[] = [];
  const notices: string[] = [];

  // Contracts: every role, every call (idempotent overwrite) — they double as the
  // RUNBOOK's self-pass checklists, so eco mode needs them too. It gets its OWN: the fan-out
  // contract addresses a subagent handed `ITEMS=` that RETURNS structured output, and neither
  // exists on the sequential path — least of all in CI, where the adjudicator has no shell and
  // writes a file. Emitting the fan-out text there and then telling an agent to obey it VERBATIM
  // is two contradictory sets of instructions, which is what a small model breaks on.
  for (const [name, content] of Object.entries(agentContracts(run, { eco: opts.eco === true, verify: verifyRunContext(run) }))) {
    const p = join(agentsDir, `${name}.md`);
    writeFileSync(p, content);
    written.push(p);
  }

  // Reconcile before emitting: a workflow script left behind by an earlier
  // emission whose worklist has since emptied or disappeared is a launchable
  // fan-out over ids that no longer exist — "deterministic and idempotent"
  // means the orchestration dir always mirrors the CURRENT run state.
  const emitted = new Set(opts.eco ? [] : selected.filter((p) => p.items > 0).map((p) => p.name));
  for (const ph of phases) {
    if (emitted.has(ph.name)) continue;
    const stale = join(orchDir, `${ph.name}.workflow.mjs`);
    if (existsSync(stale)) {
      rmSync(stale, { force: true });
      notices.push(`phase "${ph.name}": stale workflow removed — its worklist ${ph.ready ? "is now empty" : "no longer exists"}.`);
    }
  }

  if (!opts.eco) {
    for (const ph of selected) {
      if (ph.items === 0) {
        notices.push(`phase "${ph.name}": worklist is empty — nothing to orchestrate.`);
        continue;
      }
      if (ph.items <= SMALL_WORKLIST) {
        notices.push(`phase "${ph.name}": only ${ph.items} item(s) — the sequential --eco path is equivalent and cheaper.`);
      }
      const p = join(orchDir, `${ph.name}.workflow.mjs`);
      writeFileSync(p, phaseWorkflowScript(ph, run, engineAbs, BATCH_SIZE));
      written.push(p);
    }
  }

  const rb = join(orchDir, "RUNBOOK.md");
  writeFileSync(rb, runbookMd(buildManifest(run, engineAbs), unrenderedInRun(run)));
  written.push(rb);

  return { exitCode: 0, written, notices, errors: [], phases };
}
