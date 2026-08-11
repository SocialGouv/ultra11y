import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { runAudit } from "../audit.js";
import { buildAdjudicationWorklist, formatAdjudication } from "../adjudicate.js";
import { checkReport } from "../check.js";
import { formatSC } from "../criteria.js";
import { runFix, fixSummary } from "../fix.js";
import { writeHook, ciWorkflow } from "../init.js";
import { runPackCheck } from "../pack.js";
import { prdUnits, partitionUnits } from "../prd.js";
import { renderReport, renderPackReport } from "../report.js";
import { buildWorklist, formatWorklist } from "../verify.js";
import { allSC, getSC } from "../wcag.js";
import { loadPack } from "../standards/index.js";
import { attributePages, derivePages, pageScopesFrom, pagesOf, renderPageGrid, unattributedFindings } from "../pages.js";
import { PAGES_DIR, readSnapshots } from "../snapshot.js";

// The CLI's default capture directory (`--captures` overrides it there; the MCP surface has
// no such flag, so the default is the contract).
const CAPTURES_DIR = ".ultra11y/captures";
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

function standardOf(args: Record<string, unknown>): StandardId {
  const s = str(args.standard) ?? "wcag";
  if (s !== "wcag" && s !== "rgaa") throw new ToolError(`\`standard\` must be one of: wcag, rgaa (got "${s}")`);
  return s as StandardId;
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

  // The only tool that needs no project at all: it reads the vendored standard.
  if (name === "ultra11y_criteria") return outcome(handleCriteria(args));

  const cwd = requiredCwd(args, defaults);

  // Serialized per project root. `fix --write` rewrites source files and then
  // re-audits them; an audit running concurrently would read a half-written
  // tree. Different projects stay fully parallel.
  return await withProjectLock(cwd, async () => outcome(await dispatch(name, args, cwd)));
}

async function dispatch(name: string, args: Record<string, unknown>, cwd: string): Promise<unknown> {
  switch (name) {
    case "ultra11y_audit":
      return handleAudit(args, cwd);
    case "ultra11y_report":
      return handleReport(args, cwd);
    case "ultra11y_prd":
      return handlePrd(args, cwd);
    case "ultra11y_check":
      return handleCheck(args, cwd);
    case "ultra11y_verify":
      return handleVerify(args, cwd);
    case "ultra11y_adjudicate":
      return handleAdjudicate(args, cwd);
    case "ultra11y_pack_check":
      return handlePackCheck(args, cwd);
    case "ultra11y_sample_check":
      return handleSampleCheck(cwd);
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
  return { cwd, standard, lang, report: md, next: "Validate it with ultra11y_check before presenting it." };
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

function handleSampleCheck(cwd: string): unknown {
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
  return { cwd, config: raw, next: "Check the sample covers every page kind the methodology requires, not just the convenient ones." };
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
    pages: derived.map((p) => ({ id: p.id, name: p.name, url: p.url, basis: p.basis, conformancePct: p.conformancePct, findings: p.findings.length })),
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

function handleCriteria(args: Record<string, unknown>): unknown {
  const lang = langOf(args);
  const id = str(args.sc);
  if (!id) {
    return { standard: standardOf(args), criteria: allSC().map((c) => ({ sc: c.sc, title: c.title })) };
  }
  const sc = getSC(id);
  if (!sc) throw new ToolError(`no such success criterion: ${id}. List them all by omitting \`sc\`.`);
  return { standard: standardOf(args), sc: id, text: formatSC(sc, lang) };
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
