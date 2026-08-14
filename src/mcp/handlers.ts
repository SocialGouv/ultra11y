import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { runAudit } from "../audit.js";
import { buildAdjudicationWorklist, formatAdjudication } from "../adjudicate.js";
import { checkReport } from "../check.js";
import { runFix, fixSummary } from "../fix.js";
import { writeHook, ciWorkflow } from "../init.js";
import { runPackCheck } from "../pack.js";
import { prdUnits, partitionUnits } from "../prd.js";
import { renderReport, renderPackReport } from "../report.js";
import { renderHtmlDocument } from "../html.js";
import { compositeDoc, pagesIndexDoc } from "../html-report.js";
import { buildTickets } from "../tickets/grain.js";
import type { TicketGrain } from "../tickets/types.js";
import { buildWorklist, formatWorklist } from "../verify.js";
import { criteriaIndex, criterionView, CriteriaLookupError, glossaryView, themeView } from "../criteria-view.js";
import { methodView, standardsInventory } from "../method-view.js";
import { CORE, dropScope, getPack, isCore, loadPack, resolveStandard, scopeLoaded, withScope, type Tier } from "../standards/index.js";
import { loadRuntimeStandards } from "../config.js";
import { kindLabel, lintSample, sampleFromSnapshots, unionSample, validateSample } from "../sample.js";
import { attributePages, derivePages, pageScopesFrom, pagesOf, renderPageGrid, unattributedFindings } from "../pages.js";
import { PAGES_DIR, readSnapshots } from "../snapshot.js";

// The CLI's default capture directory (`--captures` overrides it there; the MCP surface has
// no such flag, so the default is the contract).
import { CAPTURES_DIR } from "../capture.js";
import { renderPagesDocument } from "../pages-report.js";
import { withProjectLock } from "../project-lock.js";
import type { AuditResult, Lang } from "../types.js";
import type { StandardId } from "../standards/index.js";

// Where a tool name becomes work. Every handler calls the same library
// functions the CLI does — nothing here shells out to `ultra11y`, and nothing
// here calls cli.ts, whose failure path would take the server process down with
// a process.exit on a bad argument.

export interface HandlerDefaults {
  defaultCwd?: string;
  allowWrite?: boolean;
}

export class ToolError extends Error {}

export interface ToolOutcome {
  text: string;
  artifact?: string;
}

const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

// What to audit when the caller names nothing. The CLI makes globs positional
// and required; a tool call with no globs is far likelier to mean "this
// project" than to be a mistake, and a wrong-looking empty audit is worse than
// a broad one.
const DEFAULT_GLOBS = ["**/*.html", "**/*.htm", "**/*.jsx", "**/*.tsx", "**/*.vue", "**/*.svelte"];

const WRITE_TOOL_NAMES = new Set(["ultra11y_fix", "ultra11y_scan", "ultra11y_init"]);

// Tools that answer from the vendored standard alone — no project tree to walk, so `cwd`
// is optional rather than required.
const REFERENCE_TOOL_NAMES = new Set(["ultra11y_criteria", "ultra11y_standards", "ultra11y_glossary", "ultra11y_guidance", "ultra11y_method"]);

// --------------------------------------------------------------------------
// Argument coercion
// --------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function strArray(v: unknown): string[] | undefined {
  const a = Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
  return a && a.length ? a : undefined;
}

function positive(v: unknown, key: string): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  if (n <= 0) throw new ToolError(`\`${key}\` must be greater than 0.`);
  return n;
}

function requiredCwd(args: Record<string, unknown>, defaults: HandlerDefaults): string {
  const cwd = str(args.cwd) ?? defaults.defaultCwd;
  if (!cwd) throw new ToolError("`cwd` is required: an absolute path to the project root.");
  const abs = resolve(cwd);
  if (!existsSync(abs)) throw new ToolError(`project root not found: ${abs}`);
  if (!statSync(abs).isDirectory()) throw new ToolError(`\`cwd\` is not a directory: ${abs}`);
  return abs;
}

/** `cwd` where it is optional: absent is fine, present must still be a real project root. */
function optionalCwd(args: Record<string, unknown>, defaults: HandlerDefaults): string | undefined {
  if (str(args.cwd) === undefined && defaults.defaultCwd === undefined) return undefined;
  return requiredCwd(args, defaults);
}

// The registry decides what a standard is — never a list hardcoded here. A pack loaded
// from `--pack` or the project's `.ultra11yrc.json` is a first-class standard the moment
// it validates, and `resolveStandard` already refuses an unknown key by name, listing the
// ones it does know.
function standardOf(args: Record<string, unknown>): StandardId {
  const s = str(args.standard);
  if (s === undefined) return CORE;
  try {
    return resolveStandard(s);
  } catch (e) {
    throw new ToolError(e instanceof Error ? e.message : String(e));
  }
}

function langOf(args: Record<string, unknown>): Lang {
  const l = str(args.lang) ?? "en";
  if (l !== "en" && l !== "fr") throw new ToolError(`\`lang\` must be one of: en, fr (got "${l}")`);
  return l as Lang;
}

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

export async function callTool(name: string, args: Record<string, unknown>, defaults: HandlerDefaults = {}): Promise<ToolOutcome> {
  if (WRITE_TOOL_NAMES.has(name) && !defaults.allowWrite) {
    throw new ToolError(`${name} changes files in your project and is disabled — start the server with --allow-write to enable it.`);
  }

  // The reference tools read the vendored standard, not the project tree, so `cwd` stays
  // optional on them. It is still MEANINGFUL when given: a standards pack is per-project
  // configuration, so which criteria exist at all depends on whose project is asking.
  if (REFERENCE_TOOL_NAMES.has(name)) {
    const scope = optionalCwd(args, defaults);
    return withStandards(scope, () => outcome(handleReference(name, args)));
  }

  const cwd = requiredCwd(args, defaults);

  // Serialized per project root. `fix --write` rewrites source files and then
  // re-audits them; an audit running concurrently would read a half-written
  // tree. Different projects stay fully parallel.
  return await withProjectLock(cwd, async () => withStandards(cwd, async () => outcome(await dispatch(name, args, cwd))));
}

/**
 * Run `fn` with this project's standards packs registered and visible.
 *
 * Exported because the RESOURCE layer needs it too: `resources/read` carries no `cwd`, so a
 * `std://` read resolves against the server's own project root. Without this, a server
 * dedicated to a project would serve that project's packs as tools and deny they exist as
 * resources.
 */
export function withStandards<T>(scope: string | undefined, fn: () => T): T {
  if (scope === undefined) return fn();
  // Resolving a project's `.ultra11yrc.json` is a filesystem read; memoize it per root so a
  // long-lived server does it once, not once per tool call.
  if (!scopeLoaded(scope)) {
    const warnings: string[] = [];
    let errors: string[];
    try {
      errors = loadRuntimeStandards(scope, [], (m) => warnings.push(m), false, { scope }).errors;
    } catch (e) {
      dropScope(scope);
      throw new ToolError(`${scope}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // A pack that does not validate is a hard error, never a silent fallback to WCAG: the
    // caller asked to be audited against a standard, and quietly using a different one is
    // exactly the false conformance claim this tool exists to prevent. Drop the scope so a
    // fixed config is picked up on the next call instead of being memoized as broken.
    if (errors.length) {
      dropScope(scope);
      throw new ToolError(`${scope}: ${errors.join("\n")}`);
    }
  }
  return withScope(scope, fn);
}

function handleReference(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "ultra11y_criteria":
      return handleCriteria(args);
    case "ultra11y_standards":
      return handleStandards(args);
    case "ultra11y_glossary":
      return handleGlossary(args);
    case "ultra11y_guidance":
      return handleGuidance(args);
    case "ultra11y_method":
      return handleMethod(args);
    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}

async function dispatch(name: string, args: Record<string, unknown>, cwd: string): Promise<unknown> {
  switch (name) {
    case "ultra11y_audit":
      return handleAudit(args, cwd);
    case "ultra11y_report":
      return handleReport(args, cwd);
    case "ultra11y_prd":
      return handlePrd(args, cwd);
    case "ultra11y_tickets":
      return handleTickets(args, cwd);
    case "ultra11y_check":
      return handleCheck(args, cwd);
    case "ultra11y_verify":
      return handleVerify(args, cwd);
    case "ultra11y_adjudicate":
      return handleAdjudicate(args, cwd);
    case "ultra11y_pack_check":
      return handlePackCheck(args, cwd);
    case "ultra11y_sample_check":
      return handleSampleCheck(cwd, standardOf(args));
    case "ultra11y_pages":
      return handlePages(args, cwd);
    case "ultra11y_read":
      return handleRead(args, cwd);
    case "ultra11y_fix":
      return handleFix(args, cwd);
    case "ultra11y_init":
      return handleInit(args, cwd);
    case "ultra11y_scan":
      return handleScan(args, cwd);
    default:
      // Unreachable: the server rejects an unknown tool before dispatch.
      throw new ToolError(`unknown tool: ${name}`);
  }
}

function outcome(result: unknown): ToolOutcome {
  return { text: JSON.stringify(result, null, 2) + "\n" };
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------

// The audit every reporting tool is built on. Run from the project root so the
// globs resolve the way the CLI resolves them.
function audit(args: Record<string, unknown>, cwd: string): AuditResult {
  const prev = process.cwd();
  const warnings: string[] = [];
  try {
    process.chdir(cwd);
    const inputs = strArray(args.globs) ?? DEFAULT_GLOBS;
    const scopedToDiff = bool(args.changed) || bool(args.staged) || str(args.since) !== undefined;

    // RENDERED ARTEFACTS. `cmdAudit` appends `.ultra11y/captures` and `.ultra11y/pages` to the
    // inputs and records the page scope; this helper did not, so every MCP tool audited LESS
    // than the same command on the CLI: no rendered tier, none of the page-scoped rules
    // (lang, title, main landmark), and no page dimension at all. An agent driving the server
    // was quietly getting a smaller audit than the one it would have run itself.
    const extra = [CAPTURES_DIR, PAGES_DIR].filter((d) => !scopedToDiff && existsSync(d) && !inputs.includes(d));

    const result = runAudit({
      inputs: [...inputs, ...extra],
      include: strArray(args.include),
      exclude: strArray(args.exclude),
      forceJsx: bool(args.jsx),
      changed: bool(args.changed),
      since: str(args.since),
      staged: bool(args.staged),
      graph: bool(args.graph),
      maxFiles: positive(args.max_files, "max_files"),
      onWarn: (m) => warnings.push(m),
    });

    // Record the pages in scope so the projection can rebuild from this result alone — the
    // same step cmdAudit takes right after runAudit.
    if (extra.includes(PAGES_DIR)) {
      const scope = pageScopesFrom(readSnapshots("."));
      if (scope.length) {
        result.scope.pages = scope;
        attributePages(result, scope);
      }
    }
    return result;
  } finally {
    process.chdir(prev);
  }
}

function handleAudit(args: Record<string, unknown>, cwd: string): unknown {
  const r = audit(args, cwd);
  return {
    cwd,
    ...r,
    next:
      "Static analysis decides only a few criteria. Run ultra11y_adjudicate for the judgment ones, and ultra11y_scan for the rendering ones " +
      "(contrast, focus, zoom) — a criterion nobody tested is untested, not conformant.",
  };
}

function handleReport(args: Record<string, unknown>, cwd: string): unknown {
  const standard = standardOf(args);
  const lang = langOf(args);
  const r = audit(args, cwd);
  const md = standard === "wcag" ? renderReport(r, lang) : renderPackReport(r, loadPack(standard), lang);
  return {
    cwd,
    standard,
    lang,
    report: md,
    ...(args.html === true ? { html: renderHtmlDocument(compositeDoc(r, { standard, lang })) } : {}),
    next: "Validate it with ultra11y_check before presenting it.",
  };
}

function handlePrd(args: Record<string, unknown>, cwd: string): unknown {
  const standard = standardOf(args);
  const lang = langOf(args);
  const r = audit(args, cwd);
  const units = prdUnits(r, standard, lang);
  const { nc, advisory } = partitionUnits(units);
  return {
    cwd,
    standard,
    non_conformities: nc,
    advisory,
    ...(str(args.split) === "criterion" ? { grouped_by: "criterion" } : {}),
  };
}

/** `ultra11y_tickets` — the ticket PLAN, and only the plan. It never files anything.
 *  Creating issues in somebody's tracker is an outward-facing, hard-to-undo side effect, and
 *  a prompt-injected agent must not be able to trigger it: filing stays a deliberate human
 *  `ultra11y tickets` invocation. This tool exists so an agent can SHOW the backlog it would
 *  open, then hand the reader the exact command. */
function handleTickets(args: Record<string, unknown>, cwd: string): unknown {
  const standard = standardOf(args);
  const lang = langOf(args);
  const grain = (str(args.grain) ?? "criterion") as TicketGrain;
  const plan = buildTickets(audit(args, cwd), { grain, standard, lang, baseDir: cwd });
  if (plan.error === "no-pages") {
    return { cwd, standard, grain, error: "no-pages", hint: "No page in scope — capture snapshots (render --e2e) or scan a sample (scan --sample) first." };
  }
  return {
    cwd,
    standard,
    grain,
    dry_run: true,
    tickets: plan.tickets.map((t) => ({ title: t.title, labels: t.labels, severity: t.severity, advisory: t.advisory, scope: t.scope, body: t.body })),
    unattributed: plan.unattributed,
    to_file_them: `ultra11y tickets --in <audit.json> --provider github|gitlab|jira --grain ${grain}`,
  };
}

function handleCheck(args: Record<string, unknown>, cwd: string): unknown {
  const text = reportText(args, "check");
  const res = checkReport(text, standardOf(args), langOf(args));
  // ok:false is a verdict, not a failure: the tool did its job and the report
  // did not pass.
  return { cwd, source: str(args.report_text) ? "inline" : "file", ...res };
}

function handleVerify(args: Record<string, unknown>, cwd: string): unknown {
  const text = reportText(args, "verify");
  const standard = standardOf(args);
  const max = positive(args.max_verify, "max_verify");
  const items = max === undefined ? buildWorklist(text, standard) : buildWorklist(text, standard, max);
  return {
    cwd,
    standard,
    count: items.length,
    items,
    worklist: formatWorklist(items, true, standard, langOf(args)),
    next: "For each item, read the real markup with ultra11y_read and judge whether the evidence carries the claim.",
  };
}

function handleAdjudicate(args: Record<string, unknown>, cwd: string): unknown {
  const standard = standardOf(args);
  const r = audit(args, cwd);
  const items = buildAdjudicationWorklist(r, { cwd, standard });
  return {
    cwd,
    standard,
    count: items.length,
    items,
    worklist: formatAdjudication(items, langOf(args)),
    next: "These are the criteria the engine cannot decide. Read each element's real context with ultra11y_read, then rule on it.",
  };
}

function handlePackCheck(args: Record<string, unknown>, cwd: string): unknown {
  const pack = str(args.pack);
  if (!pack) throw new ToolError("`pack` is required — an absolute path to the pack JSON.");
  if (!isAbsolute(pack)) throw new ToolError("`pack` must be an absolute path.");
  const res = runPackCheck(pack, str(args.guidance));
  return { cwd, ...res };
}

function handleSampleCheck(cwd: string, standard: StandardId): unknown {
  const file = join(cwd, ".ultra11yrc.json");
  if (!existsSync(file)) {
    throw new ToolError(`no .ultra11yrc.json at ${cwd} — a page sample must be declared before it can be linted.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ToolError(`.ultra11yrc.json is not valid JSON: ${(e as Error).message}`);
  }
  // Actually LINT, rather than handing the caller the raw config and an instruction to check it
  // themselves — an agent asked to eyeball a sample will agree with it. And lint the UNION with
  // the snapshots on disk, so the verdict describes the surface that was audited rather than the
  // list someone remembered to declare.
  const v = validateSample((raw as { sample?: unknown })?.sample);
  if (!v.ok || !v.sample) {
    return { cwd, ok: false, issues: v.issues, next: "Fix the sample block before linting it." };
  }
  const snapshotted = sampleFromSnapshots(readSnapshots(cwd));
  const union = unionSample(v.sample, snapshotted);
  const methodology = isCore(standard) ? undefined : getPack(standard)?.sampleMethodology;
  const missing = methodology ? lintSample(union.sample, methodology).missing : [];
  return {
    cwd,
    standard,
    ok: true,
    declared: v.sample.pages.length,
    snapshotted: snapshotted.length,
    undeclared: union.undeclared.map((p) => ({ id: p.id, url: p.url })),
    uncaptured: union.uncaptured.map((p) => ({ id: p.id, url: p.url })),
    missing: missing.map((k) => ({ id: k.id, label: kindLabel(k, "fr") })),
    warnings: v.warnings,
    next:
      union.undeclared.length > 0
        ? "Snapshotted pages are missing from the declared sample: the declared list is not the audited surface. `pages discover --from-snapshots --write` folds them in."
        : "The sample covers the required page kinds over the union of what is declared and what was captured.",
  };
}

/** The page dimension. Everything it needs is already on the AuditResult, so it re-measures
 *  nothing — the same projection the report and the CLI use. */
function handlePages(args: Record<string, unknown>, cwd: string): unknown {
  const standard = standardOf(args);
  const lang = langOf(args);
  const r = audit(args, cwd);
  const scope = pagesOf(r);
  if (!scope.length) {
    throw new ToolError(
      "no page in scope: this audit covers no snapshot (.ultra11y/pages) and no scanned sample. " +
        "Capture pages with the E2E plugins, `ultra11y dev`, or `scan` (which snapshots every page it visits), then re-run.",
    );
  }
  attributePages(r, scope);
  const derived = derivePages(r, scope);
  const format = typeof args.format === "string" ? args.format : "grid";
  const markdown = format === "report" ? renderPagesDocument(r, derived, { standard, lang }) : renderPageGrid(r, scope, standard, lang);
  return {
    cwd,
    standard,
    lang,
    markdown,
    ...(args.html === true ? { html: renderHtmlDocument(pagesIndexDoc(r, { standard, lang, sheetHref: (id) => `#page-${id}` })) } : {}),
    // `conformancePct` is null when this page decided nothing — a machine consumer must be able
    // to tell "no criterion was assessed" from "every assessed criterion passed", which a bare
    // 100 conflates. `decided`/`total` are the denominator that makes the number quotable.
    pages: derived.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      basis: p.basis,
      conformancePct: p.conformancePct,
      decided: p.decided,
      total: p.total,
      findings: p.findings.length,
    })),
    unattributed: unattributedFindings(r).length,
    next: 'A page whose basis is "attributed" has no snapshot: absence of a finding there is NOT conformity. Its undecided criteria stay yours to adjudicate.',
  };
}

function handleFix(args: Record<string, unknown>, cwd: string): unknown {
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    const write = bool(args.write);
    const res = runFix({
      inputs: strArray(args.globs) ?? DEFAULT_GLOBS,
      only: strArray(args.only),
      changed: bool(args.changed),
      write,
      safe: true,
    });
    return {
      cwd,
      applied: write,
      summary: fixSummary(res, langOf(args), write),
      ...res,
      ...(write ? {} : { next: "This was a dry run. Pass write:true to apply it." }),
    };
  } finally {
    process.chdir(prev);
  }
}

function handleInit(args: Record<string, unknown>, cwd: string): unknown {
  const failOnRaw = str(args.fail_on) ?? "error";
  if (!["error", "warning", "notice"].includes(failOnRaw)) {
    throw new ToolError(`\`fail_on\` must be one of: error, warning, notice (got "${failOnRaw}")`);
  }
  const failOn = failOnRaw as Parameters<typeof writeHook>[2];
  const enginePath = resolve("scripts/ultra11y.mjs");
  const written: string[] = [];
  if (bool(args.hook)) written.push(writeHook(cwd, enginePath, failOn));
  if (bool(args.ci)) written.push(join(cwd, ".github/workflows/a11y.yml"));
  if (!written.length) {
    throw new ToolError("nothing to install — pass hook:true and/or ci:true.");
  }
  return { cwd, written, ...(bool(args.ci) ? { ci_workflow: ciWorkflow(enginePath, failOn) } : {}) };
}

function handleScan(args: Record<string, unknown>, cwd: string): unknown {
  const target = str(args.target);
  if (!target) throw new ToolError("`target` is required — a URL or a local HTML file to render.");
  // Deliberately not implemented in-process: `scan` drives a headless browser
  // and optionally pulls a Docker image, which is a subprocess lifecycle a
  // long-lived server should not own. Say so precisely rather than fail
  // obscurely, and name the command that does it.
  throw new ToolError(
    `ultra11y_scan is not available over MCP: it launches a headless browser (and may pull a Docker image), which this server does not manage. ` +
      `Run it from the CLI instead — \`ultra11y scan ${target} --merge\` in ${cwd} — then re-run ultra11y_audit to see the merged result.`,
  );
}

// The report to operate on: inline text, or a file the caller named.
function reportText(args: Record<string, unknown>, tool: string): string {
  const inline = str(args.report_text);
  const file = str(args.report_file);
  if (inline && file) throw new ToolError("pass `report_text` or `report_file`, not both.");
  if (inline) return inline;
  if (!file) throw new ToolError(`\`report_text\` is required — the report markdown for ultra11y_${tool} to work on.`);
  if (!isAbsolute(file)) throw new ToolError("`report_file` must be an absolute path.");
  if (!existsSync(file)) throw new ToolError(`report file not found: ${file}`);
  return readFileSync(file, "utf8");
}

// The offline reference, for ANY registered standard.
//
// This used to call the WCAG core unconditionally and echo `standard` back untouched, so
// `{ standard: "rgaa", sc: "8.3" }` answered a question about RGAA with "no such success
// criterion". Everything now goes through the same query layer the CLI printer uses.
function handleCriteria(args: Record<string, unknown>): unknown {
  const lang = langOf(args);
  const standard = standardOf(args);
  const includeGuidance = bool(args.include_guidance);

  // `sc` and `criterion` are aliases. "8.3" is not a *success criterion*, and a worldwide
  // tool should not force a country criterion to be named one — but `sc` is what the
  // shipped bundle and every existing client send.
  const id = str(args.criterion) ?? str(args.sc);
  const glossary = args.glossary;
  const theme = num(args.theme);

  try {
    if (glossary !== undefined && glossary !== false) {
      return glossaryView(standard, typeof glossary === "string" ? glossary : undefined, lang);
    }
    if (id) {
      const view = criterionView(standard, id, lang, includeGuidance);
      // `sc` is kept alongside `id` so a client written against the old shape still reads.
      return isCore(standard) ? { ...view, sc: id } : view;
    }
    if (theme !== undefined) return themeView(standard, theme, lang);
    return criteriaIndex(standard, lang);
  } catch (e) {
    if (e instanceof CriteriaLookupError) {
      throw new ToolError(e.suggestions.length ? `${e.message} Did you mean: ${e.suggestions.join(", ")}?` : e.message);
    }
    throw e;
  }
}

function handleStandards(_args: Record<string, unknown>): unknown {
  return standardsInventory();
}

function handleGlossary(args: Record<string, unknown>): unknown {
  const standard = standardOf(args);
  try {
    return glossaryView(standard, str(args.term), langOf(args));
  } catch (e) {
    if (e instanceof CriteriaLookupError) {
      throw new ToolError(e.suggestions.length ? `${e.message} Did you mean: ${e.suggestions.join(", ")}?` : e.message);
    }
    throw e;
  }
}

function handleGuidance(args: Record<string, unknown>): unknown {
  const standard = standardOf(args);
  const lang = langOf(args);
  const id = str(args.criterion) ?? str(args.sc);
  if (!id) throw new ToolError("`criterion` is required: the criterion id to fetch guidance for.");
  // Reuses the criterion lookup so an id the standard does not define fails the same way
  // here as it does everywhere else, rather than returning a silent empty list.
  const view = criterionView(standard, id, lang, true);
  const guidance = (view.criterion as { guidance: unknown[] }).guidance;
  return {
    standard,
    standardLabel: view.standardLabel,
    criterion: id,
    lang,
    count: guidance.length,
    entries: guidance,
    note: guidance.length
      ? "Guidance illustrates how to implement a criterion. It never decides a verdict, and an entry marked `inherited` comes from the WCAG mapping, not from this standard's own doctrine."
      : "No guidance is registered for this criterion, in this standard or through its WCAG mapping. That is not a pass — it means no example was written.",
  };
}

function handleMethod(args: Record<string, unknown>): unknown {
  const standard = standardOf(args);
  const lang = langOf(args);
  const tier = str(args.tier) as Tier | undefined;
  const detail = str(args.detail) === "full" ? "full" : "summary";
  return methodView(standard, lang, { ...(tier ? { tier } : {}), detail });
}

function handleRead(args: Record<string, unknown>, cwd: string): unknown {
  const raw = str(args.path);
  if (!raw) throw new ToolError("`path` is required — relative to the project root, or an absolute path inside it.");
  const target = isAbsolute(raw) ? raw : join(cwd, raw);

  // Containment on the REALPATH: a symlink inside the project normalises
  // cleanly as a string and only escapes once the filesystem resolves it. This
  // server can be reached over HTTP.
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    throw new ToolError(`no such file: ${raw}`);
  }
  const root = realpathSync(cwd);
  if (real !== root && !real.startsWith(root + sep)) {
    throw new ToolError(`path is outside the project: ${raw}. Use your own file tool for anything else.`);
  }

  const st = statSync(real);
  if (!st.isFile()) throw new ToolError(`not a file: ${raw}`);
  if (st.size > MAX_READ_BYTES) throw new ToolError(`file is too large to read (${st.size} bytes): ${raw}`);

  const lines = readFileSync(real, "utf8").split("\n");
  const total = lines.length;
  const start = Math.max(1, Math.floor(num(args.start_line) ?? 1));
  if (start > total) throw new ToolError(`start_line ${start} is past the end of the file (${total} lines).`);
  const requestedEnd = Math.floor(num(args.end_line) ?? total);
  const end = Math.min(total, Math.max(start, requestedEnd), start + MAX_READ_LINES - 1);

  return {
    path: isAbsolute(raw) ? real : raw,
    start_line: start,
    end_line: end,
    total_lines: total,
    truncated: end < Math.min(total, requestedEnd),
    content: lines.slice(start - 1, end).join("\n"),
  };
}
