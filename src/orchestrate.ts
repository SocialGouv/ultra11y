import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { unrenderedResidual, type AdjudicationFile, type AdjudicationItem } from "./adjudicate.js";
import type { AuditResult } from "./types.js";
import { agentContracts, phaseWorkflowScript, runbookMd } from "./orchestrate-templates.js";
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
export function verifyRunContext(runDir: string): { report: string; flags: string; standard?: string } {
  const run = resolve(runDir);
  const ctx = readVerifyContext(run);
  const standard = runStandard(run);
  const flags = [`--in ${ctx?.in ?? join(run, "audit-latest.json")}`];
  if (standard) flags.push(`--standard ${standard}`);
  if (ctx?.conformities.source === "file") flags.push(`--conformities ${ctx.conformities.path}`);
  if (ctx?.conformities.source === "disabled") flags.push("--no-conformities");
  return { report: ctx && ctx.report !== "-" ? ctx.report : "<report.md>", flags: flags.join(" "), ...(standard ? { standard } : {}) };
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

  const vctx = verifyRunContext(run);
  return [
    {
      name: "adjudicate",
      ready: adjReady,
      worklist: adjPath,
      items: adjIds.length,
      ids: adjIds,
      prerequisite: `node ${engineAbs} verify --manual --in ${join(run, "audit-latest.json")} --out ${run}`,
      apply: `node ${engineAbs} verify --apply ${adjPath} --in ${join(run, "audit-latest.json")} --out ${run}`,
    },
    {
      name: "verify-report",
      ready: verReady,
      worklist: verPath,
      items: verIds.length,
      ids: verIds,
      prerequisite: `node ${engineAbs} verify --report ${vctx.report} ${vctx.flags} --out ${run}`,
      apply: `node ${engineAbs} verify --apply ${verPath} --report ${vctx.report} ${vctx.flags}`,
    },
  ];
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
  writeFileSync(rb, runbookMd(phases, run, engineAbs, unrenderedInRun(run), verifyRunContext(run)));
  written.push(rb);

  return { exitCode: 0, written, notices, errors: [], phases };
}
