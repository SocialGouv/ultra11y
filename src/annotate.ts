// GitHub Actions surfaces, for the CI path that cannot use code scanning.
//
//  • `annotations()` — workflow commands (`::error file=…,line=…::`). Every GitHub plan
//    renders these inline on the diff, so this is the fallback when SARIF upload is
//    unavailable (a private repo without Advanced Security).
//  • `stepSummary()` — the Markdown written to `$GITHUB_STEP_SUMMARY`: the run's headline,
//    a severity table, and — once the audit carries a page sample — the per-page synthesis.
//
// Both are pure string builders. Nothing here decides anything: a finding that is not
// anchorable in the repo tree (a URL-keyed dynamic result) is skipped rather than pinned
// to an invented line.
import { findingsAtOrAbove } from "./baseline.js";
import { resolveMessage, resolveRemediation } from "./messages.js";
import { findingsForStandard, packCriteriaForFinding } from "./standards/derive.js";
import { CORE, type StandardId, isCore, loadPack } from "./standards/index.js";
import type { AuditResult, Finding, Lang, Severity } from "./types.js";
import { isUrlPath, repoRelative } from "./util.js";

export interface AnnotateOptions {
  standard?: StandardId;
  lang?: Lang;
  /** Only annotate findings at or above this severity. Absent = annotate everything. */
  failOn?: Severity;
  /** Root the annotated paths are made relative to. Defaults to the process CWD. */
  baseDir?: string;
}

const LEVEL: Record<Severity, string> = { bloquant: "error", majeur: "warning", mineur: "notice" };
const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };
const SEV_ORDER: Severity[] = ["bloquant", "majeur", "mineur"];

// A workflow command is newline-delimited and its properties are comma-delimited, so the
// data has to be percent-escaped or a message would truncate (or forge) the command.
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
function esc(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escProp(s: string): string {
  return esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

const isUrl = isUrlPath;

/** The criterion label to show: the pack's own id when projected, else the WCAG SC. */
function criterionLabel(f: Finding, standard: StandardId): string {
  if (isCore(standard)) return `WCAG ${f.criteriaId}`;
  const pack = loadPack(standard);
  const ids = packCriteriaForFinding(pack, f);
  return ids.length ? `${pack.name} ${ids.join(", ")}` : `WCAG ${f.criteriaId}`;
}

/** Workflow-command annotations, one per anchorable finding. */
export function annotations(result: AuditResult, opts: AnnotateOptions = {}): string[] {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const baseDir = opts.baseDir ?? process.cwd();
  const all = findingsForStandard(result, standard);
  const scoped = opts.failOn ? findingsAtOrAbove(all, opts.failOn) : all;
  const out: string[] = [];
  for (const f of scoped) {
    if (isUrl(f.file)) continue; // no repo line to annotate — reported in the summary instead
    const level = f.advisory ? "notice" : LEVEL[f.severity];
    const file = repoRelative(f.file, baseDir);
    const title = `${criterionLabel(f, standard)} · ${f.ruleId}`;
    const body = `${resolveMessage(f, lang)}\n${resolveRemediation(f, lang)}`;
    out.push(`::${level} file=${escProp(file)},line=${Math.max(1, f.line)},col=${Math.max(1, f.col)},title=${escProp(title)}::${esc(body)}`);
  }
  return out;
}

const S = {
  fr: {
    title: "Audit d'accessibilité ultra11y",
    files: "fichiers",
    rate: "réussite automatique",
    none: "✅ Aucune non-conformité détectée par le moteur statique.",
    findings: "Non-conformités",
    severity: "Sévérité",
    criterion: "Critère",
    where: "Emplacement",
    what: "Constat",
    more: (n: number) => `… et ${n} autre(s).`,
    perPage: "Constats par page",
    page: "Page",
    count: "Constats",
    unanchored: (n: number) => `${n} constat(s) rattaché(s) à une URL, sans ligne de code à annoter — voir le rapport.`,
  },
  en: {
    title: "ultra11y accessibility audit",
    files: "files",
    rate: "automatic pass rate",
    none: "✅ No non-conformity detected by the static engine.",
    findings: "Non-conformities",
    severity: "Severity",
    criterion: "Criterion",
    where: "Location",
    what: "Finding",
    more: (n: number) => `… and ${n} more.`,
    perPage: "Findings per page",
    page: "Page",
    count: "Findings",
    unanchored: (n: number) => `${n} finding(s) keyed to a URL, with no code line to annotate — see the report.`,
  },
} as const;

const MAX_ROWS = 50;

/** Markdown for `$GITHUB_STEP_SUMMARY`. */
export function stepSummary(result: AuditResult, opts: AnnotateOptions = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const s = S[lang];
  const stdLabel = isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name;

  const out: string[] = [];
  out.push(`## ${s.title} — ${stdLabel}`, "");
  out.push(`\`${result.date}\` · ${result.scope.files} ${s.files} · **${result.conformancePct}%** ${s.rate}`, "");

  // Resolve the standard's findings BEFORE the empty check: a page whose only defect comes
  // from a declarative pack rule has an empty `result.findings` and would otherwise be
  // reported as clean under `--standard`.
  const baseDir = opts.baseDir ?? process.cwd();
  const all = findingsForStandard(result, standard);

  if (!all.length) {
    out.push(s.none, "");
    return out.join("\n");
  }

  const sorted = [...all].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  out.push(`### ${s.findings} (${sorted.length})`, "");
  out.push(`| ${s.severity} | ${s.criterion} | ${s.where} | ${s.what} |`, "| --- | --- | --- | --- |");
  for (const f of sorted.slice(0, MAX_ROWS)) {
    const where = isUrl(f.file) ? f.file : `${repoRelative(f.file, baseDir)}:${Math.max(1, f.line)}`;
    // Pipes inside a cell would break the table.
    const msg = resolveMessage(f, lang).replace(/\|/g, "\\|");
    out.push(`| ${ICON[f.severity]} ${f.severity} | ${criterionLabel(f, standard)} | \`${where}\` | ${msg} |`);
  }
  if (sorted.length > MAX_ROWS) out.push("", s.more(sorted.length - MAX_ROWS));
  out.push("");

  const unanchored = all.filter((f) => isUrl(f.file)).length;
  if (unanchored) out.push(`> ${s.unanchored(unanchored)}`, "");

  // Per-page synthesis, when a page sample was scanned and merged in.
  const pages = result.scope.sample?.pages ?? [];
  if (pages.length) {
    out.push(`### ${s.perPage}`, "");
    out.push(`| ${s.page} | ${s.count} |`, "| --- | --- |");
    for (const pg of pages) {
      const n = all.filter((f) => f.file === pg.url || (f.sample?.page !== undefined && f.sample.page === pg.name)).length;
      out.push(`| ${pg.name} — \`${pg.url}\` | ${n} |`);
    }
    out.push("");
  }

  return out.join("\n");
}
