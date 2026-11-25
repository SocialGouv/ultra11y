// THE AUDIT HISTORY behind `ultra11y serve` — which audits a directory holds, what each one
// says, and what changed from one to the next.
//
// It DECIDES NOTHING, like every other rendering surface. A criterion's status is the row
// `packReportGroups` produces for the report's grid; the conformity rate is `conformanceRate`
// over the same totals (src/pages-report.ts); the mean rate is `averageConformanceRate`
// (src/report.ts); a page's rate is `packPageRate` over `pageCriterionRows`, exactly as its
// sheet prints it. The history only LINES THESE UP across audits and subtracts: a second
// computation of a rate is a second chance for the server to contradict the report it serves.
//
// Discovery is deliberately forgiving about layout and strict about content. An `audits/`
// directory may hold the run's `audit-latest.json`, dated copies (`audits/2026-09-01/…`,
// `audits/history/audit-2026-09-01.json`), and a great deal of other JSON (pages.json,
// worklists, ticket sets). Every JSON file up to a few levels deep is read, and only a current
// ultra11y AuditResult — bare or wrapped in the RGAA document — is kept. Identical files (the
// latest run copied into a dated folder) count once.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { averageConformanceRate, packReportGroups, reportGroups, reportTotals, type AverageRate, type ReportTally } from "./report.js";
import { conformanceRate, pageCriterionRows, pageTally, type ConformanceRate } from "./pages-report.js";
import { derivePages, packPageRate, pagesOf, type PackPageRate } from "./pages.js";
import { isCurrentAudit, unwrapAudit } from "./standards/document.js";
import { isCore, loadPack, type StandardId } from "./standards/index.js";
import type { AuditResult, Lang, PageResult, Status } from "./types.js";

/** How deep under the audits directory JSON files are looked for. `audits/<date>/x.json` is
 *  depth 1; a history folder of dated runs is depth 2. Deeper is someone else's tree. */
export const HISTORY_MAX_DEPTH = 3;

/** JSON files larger than this are not read: an audit of a large application is a few MB,
 *  and a 200 MB file in `audits/` is not one of ours. */
export const HISTORY_MAX_BYTES = 64 * 1024 * 1024;

/** Directories never walked: the evidence and page assets the report copies beside itself
 *  carry no audit, and a dependency tree is not history. */
const SKIP_DIRS = new Set(["assets", "node_modules"]);

/** One audit found on disk. */
export interface AuditEntry {
  /** URL-safe and unique within the history: the audit's date, suffixed `-2`, `-3`… when two
   *  audits share one. */
  id: string;
  /** Absolute path of the JSON file. */
  file: string;
  /** The file, relative to the audits directory, POSIX separators. */
  rel: string;
  /** Absolute directory holding the file. */
  dir: string;
  mtimeMs: number;
  result: AuditResult;
}

interface JsonFile {
  file: string;
  size: number;
  mtimeMs: number;
}

/** Every candidate JSON file, without reading one. Symbolic links are not followed: a link in
 *  `audits/` pointing elsewhere must not pull a foreign tree into the history (the server's
 *  file guard refuses to serve through one for the same reason). */
function jsonFiles(dir: string, depth = 0, out: JsonFile[] = []): JsonFile[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < HISTORY_MAX_DEPTH && !SKIP_DIRS.has(e.name)) jsonFiles(path, depth + 1, out);
      continue;
    }
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".json")) continue;
    try {
      const st = statSync(path);
      if (st.size <= HISTORY_MAX_BYTES) out.push({ file: path, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // Vanished between the listing and the stat: not part of this history.
    }
  }
  return out;
}

/** A cheap fingerprint of the directory's JSON files (path, size, mtime) — what the server
 *  compares to know whether the history must be read again. */
export function historySignature(dir: string): string {
  return jsonFiles(dir)
    .map((f) => `${f.file}\0${f.size}\0${f.mtimeMs}`)
    .join("\n");
}

const slug = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "audit";

/** The audits under `dir`, oldest first (by the audit's own date, then file time, then path). */
export function discoverAudits(dir: string): AuditEntry[] {
  const found: Omit<AuditEntry, "id">[] = [];
  const seen = new Set<string>();
  // SHALLOWEST FIRST, so that among identical copies the one kept is the canonical
  // `audits/audit-latest.json`, not a dated copy (`audits/2026-10-15/…`) that a depth-first
  // walk reaches earlier because digits sort before letters. The kept entry's directory is
  // where its report, its annex and its `assets/` screenshots live.
  const depth = (f: JsonFile): number => relative(dir, f.file).split(sep).length;
  const files = jsonFiles(dir).sort((a, b) => depth(a) - depth(b) || a.file.localeCompare(b.file));
  for (const f of files) {
    let raw: string;
    try {
      raw = readFileSync(f.file, "utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter: an AuditResult always names its tool. Spares a parse of every
    // worklist and ticket set in the directory.
    if (!raw.includes('"ultra11y"')) continue;
    const hash = createHash("sha256").update(raw).digest("hex");
    if (seen.has(hash)) continue;
    let parsed: unknown;
    try {
      parsed = unwrapAudit(JSON.parse(raw));
    } catch {
      continue;
    }
    if (!isCurrentAudit(parsed)) continue;
    seen.add(hash);
    found.push({
      file: f.file,
      rel: relative(dir, f.file).split(sep).join("/"),
      dir: join(f.file, ".."),
      mtimeMs: f.mtimeMs,
      result: parsed,
    });
  }
  found.sort((a, b) => a.result.date.localeCompare(b.result.date) || a.mtimeMs - b.mtimeMs || a.rel.localeCompare(b.rel));
  const used = new Map<string, number>();
  return found.map((e) => {
    const base = slug(e.result.date);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { ...e, id: n === 1 ? base : `${base}-${n}` };
  });
}

/** One criterion as the report's exhaustive grid shows it: `NA` for a conformity reached for
 *  want of a subject, exactly as `criteriaGridBlocks` (src/html-report.ts) prints it. */
export interface GridRow {
  id: string;
  label: string;
  group: string;
  status: Status;
}

/** One page of one audit, rated as its sheet rates it. */
export interface PageRate {
  id: string;
  name: string;
  url: string;
  rate: PackPageRate;
}

/** What one audit says, in the numbers the server shows. */
export interface AuditSummary {
  entry: AuditEntry;
  standard: StandardId;
  rows: GridRow[];
  totals: ReportTally;
  /** The conformity rate (validated ÷ applicable). NULL when nothing is applicable: the report
   *  refuses to print « 100 % (0/0) », and so does the server. */
  rate: ConformanceRate | null;
  /** The RGAA « taux moyen » over the pages, when the audit has pages. */
  average?: AverageRate;
  pages: PageRate[];
  /** The pages as `derivePages` projects them, for the sheets. */
  derived: PageResult[];
}

export function summarize(entry: AuditEntry, standard: StandardId, lang: Lang): AuditSummary {
  const r = entry.result;
  const groups = isCore(standard) ? reportGroups(r, lang) : packReportGroups(r, loadPack(standard), lang);
  const rows: GridRow[] = groups.flatMap((g) =>
    g.rows.map((row) => ({ id: row.id, label: row.label, group: `${g.key} ${g.title}`.trim(), status: row.inapplicable ? ("NA" as const) : row.status })),
  );
  const totals = reportTotals(groups);
  const rate = conformanceRate(totals);
  const derived = derivePages(r, pagesOf(r));
  const pages = derived.map((p) => ({ id: p.id, name: p.name, url: p.url, rate: packPageRate(pageTally(pageCriterionRows(r, p, standard, lang))) }));
  return {
    entry,
    standard,
    rows,
    totals,
    rate: rate.applicable === 0 ? null : rate,
    ...(!isCore(standard) && derived.length ? { average: averageConformanceRate(r, derived, standard, lang) } : {}),
    pages,
    derived,
  };
}

/** How a criterion moved between two audits. Named by what a reader does next, never by a
 *  colour: `fixed` NC → C/NA, `regressed` anything → NC, `decided` « to assess » → C/NA,
 *  `reopened` decided → « to assess », `requalified` C ↔ NA. */
export type ChangeKind = "fixed" | "regressed" | "decided" | "reopened" | "requalified" | "added" | "removed";

export function classifyChange(before: Status | undefined, after: Status | undefined): ChangeKind | undefined {
  if (before === after) return undefined;
  if (before === undefined) return "added";
  if (after === undefined) return "removed";
  if (after === "NC") return "regressed";
  if (after === "manual") return "reopened";
  if (before === "NC") return "fixed";
  if (before === "manual") return "decided";
  return "requalified";
}

export interface CriterionChange {
  id: string;
  label: string;
  group: string;
  before?: Status;
  after?: Status;
  kind: ChangeKind;
}

export interface PageEvolution {
  id: string;
  name: string;
  url: string;
  before?: PackPageRate;
  after?: PackPageRate;
  /** Percentage points, NULL when either side has no rate. */
  delta: number | null;
}

export interface Evolution {
  from: AuditSummary;
  to: AuditSummary;
  /** Conformity-rate change in percentage points; NULL when either audit has no rate. */
  rateDelta: number | null;
  /** Mean-rate change in percentage points; NULL when either audit has no mean. */
  averageDelta: number | null;
  /** Every criterion of both grids, in the newer grid's order, with its two statuses. */
  grid: { id: string; label: string; group: string; before?: Status; after?: Status }[];
  /** The criteria whose status changed. */
  changes: CriterionChange[];
  pages: PageEvolution[];
}

const diff = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined ? null : b - a;

/** What changed from `from` (older) to `to` (newer). Pure subtraction over two summaries. */
export function evolution(from: AuditSummary, to: AuditSummary): Evolution {
  const before = new Map(from.rows.map((r) => [r.id, r]));
  const after = new Map(to.rows.map((r) => [r.id, r]));
  const grid: Evolution["grid"] = [];
  for (const r of to.rows)
    grid.push({ id: r.id, label: r.label, group: r.group, after: r.status, ...(before.has(r.id) ? { before: before.get(r.id)!.status } : {}) });
  for (const r of from.rows) if (!after.has(r.id)) grid.push({ id: r.id, label: r.label, group: r.group, before: r.status });
  const changes: CriterionChange[] = [];
  for (const g of grid) {
    const kind = classifyChange(g.before, g.after);
    if (kind) changes.push({ ...g, kind });
  }
  // Pages are matched by id, then by URL: a page re-captured under another id is still the page.
  const pages: PageEvolution[] = [];
  const matched = new Set<string>();
  for (const p of to.pages) {
    const prev = from.pages.find((q) => q.id === p.id) ?? from.pages.find((q) => q.url === p.url);
    if (prev) matched.add(prev.id);
    pages.push({ id: p.id, name: p.name, url: p.url, after: p.rate, ...(prev ? { before: prev.rate } : {}), delta: diff(prev?.rate.pct, p.rate.pct) });
  }
  for (const q of from.pages) if (!matched.has(q.id)) pages.push({ id: q.id, name: q.name, url: q.url, before: q.rate, delta: null });
  return {
    from,
    to,
    rateDelta: diff(from.rate?.pct, to.rate?.pct),
    averageDelta: diff(from.average?.pct, to.average?.pct),
    grid,
    changes,
    pages,
  };
}
