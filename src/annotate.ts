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
import { attributePages, derivePages, pagesOf } from "./pages.js";

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
    perPage: "Bilan page par page",
    page: "Page",
    count: "Constats",
    basis: "Base",
    pageRate: "Taux",
    snapshot: "instantané",
    source: "source",
    unanchored: (n: number) => `${n} constat(s) rattaché(s) à une URL, sans ligne de code à annoter — voir le rapport.`,
    unattributed: (n: number) =>
      `${n} constat(s) ne sont rattachés à aucune page (code partagé, fichier hors routes) — comptés dans l'audit global, jamais répartis d'office.`,
    sourceBasis:
      "Une page marquée « source » n'a pas d'instantané : l'absence de constat n'y vaut PAS conformité, et son taux ne porte que sur ce que le moteur a pu décider ailleurs.",
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
    perPage: "Page-by-page scoreboard",
    page: "Page",
    count: "Findings",
    basis: "Basis",
    pageRate: "Rate",
    snapshot: "snapshot",
    source: "source",
    unanchored: (n: number) => `${n} finding(s) keyed to a URL, with no code line to annotate — see the report.`,
    unattributed: (n: number) =>
      `${n} finding(s) are attributed to no page (shared code, file outside any route) — counted in the overall audit, never spread across pages.`,
    sourceBasis:
      'A page marked "source" has no snapshot: the absence of a finding there does NOT mean conforming, and its rate covers only what the engine could decide elsewhere.',
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
    // Still show the scoreboard: a clean run over five pages is exactly when a reviewer
    // wants to see WHICH five, and how much of each was actually decided.
    out.push(perPageTable(result, standard, lang));
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

  out.push(perPageTable(result, standard, lang));
  return out.join("\n");
}

/** The per-page scoreboard — the surface a reviewer actually scans on a PR, one row per page
 *  with its rate and its findings by severity.
 *
 *  It keys on the pages IN SCOPE, not on `scope.sample`: a snapshot is the stronger basis
 *  (its findings were raised on the page's real rendered DOM, and it is the only basis that
 *  can earn a conforming verdict), and keying on the sample alone left every snapshotted page
 *  — the e2e plugins', the dev side-car's, and `scan`'s own — out of the table named after
 *  them. The `basis` column is not decoration: a source-attributed page cannot be conforming
 *  by silence, so its rate means something weaker than a snapshot's. */
export function perPageTable(result: AuditResult, standard: StandardId = CORE, lang: Lang = "en"): string {
  const s = S[lang];
  const scope = pagesOf(result);
  if (!scope.length) return "";
  attributePages(result, scope);
  const derived = derivePages(result, scope);
  const out: string[] = [`### ${s.perPage}`, ""];
  out.push(`| ${s.page} | ${s.basis} | ${s.pageRate} | 🔴 | 🟠 | 🟡 |`, "| --- | --- | ---: | ---: | ---: | ---: |");
  for (const pg of derived) {
    const nc = pg.findings.filter((f) => !f.advisory);
    const n = (sev: Severity): number => nc.filter((f) => f.severity === sev).length;
    out.push(
      `| ${pg.name}${pg.auth ? " 🔒" : ""} — \`${pg.url}\` | ${pg.basis === "snapshot" ? s.snapshot : s.source} | ${pg.conformancePct}% | ${n("bloquant")} | ${n("majeur")} | ${n("mineur")} |`,
    );
  }
  out.push("");
  const orphans = result.findings.filter((f) => !f.page && !f.advisory).length;
  if (orphans) out.push(`> ${s.unattributed(orphans)}`, "");
  if (derived.some((p) => p.basis !== "snapshot")) out.push(`> ${s.sourceBasis}`, "");
  return out.join("\n");
}
