// GitHub Actions surfaces, for the CI path that cannot use code scanning.
//
//  • `annotations()` — workflow commands (`::error file=…,line=…::`). Every GitHub plan
//    renders these inline on the diff, so this is the fallback when SARIF upload is
//    unavailable (a private repo without Advanced Security).
//  • `stepSummary()` — the Markdown written to `$GITHUB_STEP_SUMMARY`: the run's headline,
//    a grouped severity table, and — once the audit carries a page sample — the per-page
//    synthesis. Long and complete; the step summary has a 1 MiB budget and no reader who
//    reached it arrived by accident.
//  • `prComment()` — the DIGEST posted on the pull request. A different document, not a
//    truncation of the one above: a reviewer scanning a PR needs the verdict, the coverage
//    and the handful of distinct defects, then a link. Posting the full summary there is how
//    a real audit (472 findings over 7 distinct selectors) became a wall nobody read.
//  • `pagesComment()` — the PAGE-BY-PAGE grid, posted under its OWN sticky marker. The tier
//    that sweeps pages and the tier that gates code both comment on the same pull request,
//    and they answer different questions; sharing a marker made the sweep overwrite the gate.
//
// All are pure string builders. Nothing here decides anything: a finding that is not
// anchorable in the repo tree (a URL-keyed dynamic result) is skipped rather than pinned
// to an invented line, and every status comes from the shared projections.
import { findingsAtOrAbove } from "./baseline.js";
import { resolveMessage, resolveRemediation } from "./messages.js";
import { findingsForStandard, packCriteriaForFinding } from "./standards/derive.js";
import { CORE, type StandardId, isCore, loadPack } from "./standards/index.js";
import { packReportGroups, reportCoverage, reportGroups } from "./report.js";
import type { AuditResult, Finding, Lang, PageResult, Severity } from "./types.js";
import { isUrlPath, repoRelative } from "./util.js";
import {
  agentMarkNote,
  attributePages,
  basisLabel,
  derivePages,
  formatRate,
  pageBasisWarning,
  pagesOf,
  renderRedirected,
  unattributedFindings,
} from "./pages.js";
import { pageCriterionRows, pageTally, pageTallyNote } from "./pages-report.js";

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
    moreGroups: (n: number) => `… et ${n} autre(s) groupe(s) — voir le résumé de job.`,
    perPage: "Bilan page par page",
    page: "Page",
    count: "Constats",
    basis: "Base",
    pageRate: "Taux",
    snapshot: "instantané",
    source: "source",
    occurrences: "Occ.",
    pagesCol: "Pages",
    grouped: (groups: number, occ: number) => `${groups} défaut(s) distinct(s) · ${occ} occurrence(s)`,
    groupNote:
      "Une ligne par (critère, règle, sélecteur) : un même défaut de design system répété sur toutes les routes compte pour un. Les colonnes Occ. et Pages disent l'ampleur réelle.",
    verdictFail: (n: number) => `🔴 ${n} non-conformité(s) bloquante(s) — la porte est rouge.`,
    verdictWarn: "🟠 Aucune non-conformité bloquante ; des constats majeurs ou mineurs restent à traiter.",
    verdictPass: "✅ Aucune non-conformité relevée par le moteur statique.",
    artifact: (name: string) => `Rapport complet (HTML, captures annotées) : artefact **${name}** du run.`,
    runLink: (url: string) => `[Voir le run et son résumé de job](${url})`,
    clamped: (n: number) => `_${n} groupe(s) retiré(s) de ce commentaire pour tenir dans la limite de GitHub — le résumé de job les porte tous._`,
    unanchored: (n: number) => `${n} constat(s) rattaché(s) à une URL, sans ligne de code à annoter — voir le rapport.`,
    unattributed: (n: number) =>
      `${n} constat(s) ne sont rattachés à aucune page (code partagé, fichier hors routes) — comptés dans l'audit global, jamais répartis d'office.`,
    sourceBasis:
      "Une page marquée « source » n'a pas d'instantané : l'absence de constat n'y vaut PAS conformité, et son taux ne porte que sur ce que le moteur a pu décider ailleurs.",
    pageByPage: "page par page",
    pagesCount: (n: number) => `${n} page(s)`,
    testsCol: "Tests",
    noPages:
      "Aucune page dans le périmètre de ce run : le balayage n'a produit aucun instantané. Ce n'est pas un bilan vide, c'est un bilan absent — les critères au rendu restent à évaluer.",
    pagesDetailNote:
      "Un bloc par page portant au moins une non-conformité, et seulement ses critères **non conformes** — la grille complète (tous les critères de chaque page, avec leurs tests et leurs captures) vit dans l'artefact.",
    pagesClamped: (n: number) =>
      `_Le détail de ${n} page(s) a été retiré de ce commentaire pour tenir dans la limite de GitHub — l'artefact les porte toutes._`,
    scoreboardClamped: (n: number) => `_${n} page(s) retirée(s) du tableau pour tenir dans la limite de GitHub — l'artefact les porte toutes._`,
    noCriterionForFindings: (n: number) =>
      `${n} constat(s) sur cette page ne rendent aucun critère du référentiel non conforme : leur règle sort du périmètre d'application de chacun. Ils comptent dans les colonnes ci-dessus, et sont détaillés dans l'artefact.`,
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
    moreGroups: (n: number) => `… and ${n} more group(s) — see the job summary.`,
    perPage: "Page-by-page scoreboard",
    page: "Page",
    count: "Findings",
    basis: "Basis",
    pageRate: "Rate",
    snapshot: "snapshot",
    source: "source",
    occurrences: "Occ.",
    pagesCol: "Pages",
    grouped: (groups: number, occ: number) => `${groups} distinct defect(s) · ${occ} occurrence(s)`,
    groupNote:
      "One row per (criterion, rule, selector): one design-system defect repeated across every route counts once. The Occ. and Pages columns carry the real scale.",
    verdictFail: (n: number) => `🔴 ${n} blocking non-conformity(ies) — the gate is red.`,
    verdictWarn: "🟠 No blocking non-conformity; major or minor findings remain.",
    verdictPass: "✅ No non-conformity found by the static engine.",
    artifact: (name: string) => `Full report (HTML, annotated crops): artifact **${name}** of this run.`,
    runLink: (url: string) => `[See the run and its job summary](${url})`,
    clamped: (n: number) => `_${n} group(s) dropped from this comment to fit GitHub's limit — the job summary carries them all._`,
    unanchored: (n: number) => `${n} finding(s) keyed to a URL, with no code line to annotate — see the report.`,
    unattributed: (n: number) =>
      `${n} finding(s) are attributed to no page (shared code, file outside any route) — counted in the overall audit, never spread across pages.`,
    sourceBasis:
      'A page marked "source" has no snapshot: the absence of a finding there does NOT mean conforming, and its rate covers only what the engine could decide elsewhere.',
    pageByPage: "page by page",
    pagesCount: (n: number) => `${n} page(s)`,
    testsCol: "Tests",
    noPages:
      "No page in this run's scope: the sweep produced no snapshot. This is not an empty scoreboard, it is a missing one — the rendering criteria stay to assess.",
    pagesDetailNote:
      "One block per page carrying at least one non-conformity, and only its **non-conforming** criteria — the full grid (every criterion of every page, with its tests and its screenshot) lives in the artifact.",
    pagesClamped: (n: number) => `_The detail of ${n} page(s) was dropped from this comment to fit GitHub's limit — the artifact carries them all._`,
    scoreboardClamped: (n: number) => `_${n} page(s) dropped from the table to fit GitHub's limit — the artifact carries them all._`,
    noCriterionForFindings: (n: number) =>
      `${n} finding(s) on this page make no criterion of the standard non-conforming: their rule falls outside every criterion's applicability. They are counted in the columns above, and detailed in the artifact.`,
  },
} as const;

/** Group rows kept on the job summary. Groups, not findings — 472 occurrences of one
 *  design-system defect are one row, so this ceiling is reached by real variety only. */
const MAX_ROWS = 50;
/** Group rows kept in the pull-request digest, before the size clamp gets a say. */
const COMMENT_ROWS = 10;
/** GitHub refuses an issue-comment body past this. Documented for tickets at
 *  src/tickets/providers/github.ts; the report surface was never clamped at all, so a wide
 *  audit posted a body the API rejected with a 422 and the run reported "comment failed". */
const COMMENT_LIMIT = 65_536;

/** One (criterion, rule, selector) defect, however many times it occurs. */
export interface FindingGroup {
  criterion: string;
  ruleId: string;
  selectorHint: string;
  severity: Severity;
  message: string;
  /** A representative location — the first occurrence. The count says how many follow. */
  where: string;
  occurrences: number;
  /** Distinct pages the defect was raised on. 0 when nothing is page-attributed. */
  pages: number;
}

/** Fold findings by what is actually WRONG rather than by where it shows up.
 *
 *  The audit that motivated this had 472 findings of one rule across 38 routes, for SEVEN
 *  distinct selectors: a single design-system defect, multiplied. Listing the occurrences
 *  produced a table nobody could read, and cutting it at 50 rows produced a table that lied
 *  about the shape of the problem. Grouping shows seven defects and says, in its own columns,
 *  that they occur 472 times over 38 pages. */
export function groupFindings(findings: Finding[], standard: StandardId, lang: Lang, baseDir: string): FindingGroup[] {
  const groups = new Map<string, FindingGroup & { pageSet: Set<string> }>();
  for (const f of findings) {
    const criterion = criterionLabel(f, standard);
    const key = `${criterion} ${f.ruleId} ${f.selectorHint}`;
    const g = groups.get(key);
    if (g) {
      g.occurrences++;
      if (f.page) g.pageSet.add(f.page);
      continue;
    }
    groups.set(key, {
      criterion,
      ruleId: f.ruleId,
      selectorHint: f.selectorHint,
      severity: f.severity,
      message: resolveMessage(f, lang),
      where: isUrl(f.file) ? f.file : `${repoRelative(f.file, baseDir)}:${Math.max(1, f.line)}`,
      occurrences: 1,
      pages: 0,
      pageSet: new Set(f.page ? [f.page] : []),
    });
  }
  return [...groups.values()]
    .map(({ pageSet, ...g }) => ({ ...g, pages: pageSet.size }))
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || b.occurrences - a.occurrences || a.criterion.localeCompare(b.criterion));
}

/** The run-wide rate, WITH the denominator it never carried, and the `*` when an agent ruled
 *  a conformity the engine did not prove. `conformancePct` is computed over the decided set
 *  (src/audit.ts) and then discarded; the count comes back from the shared report model, so
 *  this number and the Markdown report's §1 total cannot disagree. */
export function runRate(result: AuditResult, standard: StandardId, lang: Lang): { text: string; agentRuled: boolean } {
  const groups = isCore(standard) ? reportGroups(result, lang) : packReportGroups(result, loadPack(standard), lang);
  const { decided, total } = reportCoverage(groups);
  const agentRuled = groups.some((g) => g.rows.some((r) => r.decidedBy === "agent" && r.status === "C"));
  return { text: `${formatRate(decided === 0 ? null : result.conformancePct, decided, total)}${agentRuled ? "*" : ""}`, agentRuled };
}

function groupTableHead(s: (typeof S)[Lang]): string[] {
  return [`| ${s.severity} | ${s.criterion} | ${s.where} | ${s.what} | ${s.occurrences} | ${s.pagesCol} |`, "| --- | --- | --- | --- | ---: | ---: |"];
}

function groupRow(g: FindingGroup): string {
  // Pipes inside a cell would break the table.
  const cell = (v: string): string => v.replace(/\|/g, "\\|");
  return `| ${ICON[g.severity]} ${g.severity} | ${cell(g.criterion)} | \`${cell(g.where)}\` (\`${cell(g.selectorHint)}\`) | ${cell(g.message)} | ${g.occurrences} | ${g.pages || "—"} |`;
}

function groupTable(rows: FindingGroup[], s: (typeof S)[Lang]): string[] {
  return [...groupTableHead(s), ...rows.map(groupRow)];
}

/** Markdown for `$GITHUB_STEP_SUMMARY`. */
export function stepSummary(result: AuditResult, opts: AnnotateOptions = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const s = S[lang];
  const stdLabel = isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name;
  const rate = runRate(result, standard, lang);

  const out: string[] = [];
  out.push(`## ${s.title} — ${stdLabel}`, "");
  out.push(`\`${result.date}\` · ${result.scope.files} ${s.files} · **${rate.text}** ${s.rate}`, "");
  if (rate.agentRuled) out.push(`> ${agentMarkNote(lang)}`, "");

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

  const grouped = groupFindings(all, standard, lang, baseDir);
  out.push(`### ${s.findings} — ${s.grouped(grouped.length, all.length)}`, "");
  out.push(`> ${s.groupNote}`, "");
  out.push(...groupTable(grouped.slice(0, MAX_ROWS), s));
  if (grouped.length > MAX_ROWS) out.push("", s.more(grouped.length - MAX_ROWS));
  out.push("");

  const unanchored = all.filter((f) => isUrl(f.file)).length;
  if (unanchored) out.push(`> ${s.unanchored(unanchored)}`, "");

  out.push(perPageTable(result, standard, lang));
  return out.join("\n");
}

/** The pull-request digest.
 *
 *  Deliberately NOT the job summary. A reviewer wants the verdict, how much of the standard
 *  was actually decided, the distinct defects, and a way to reach the rest — in a comment
 *  short enough to read without collapsing. It LINKS to the artifact rather than embedding
 *  crops: an artifact is not addressable by URL while its run is in flight, so an inline
 *  image would render as a broken box on every pull request.
 *
 *  `runUrl` / `artifactName` come from the caller (the action's env), never from this module. */
export function prComment(result: AuditResult, opts: AnnotateOptions & { runUrl?: string; artifactName?: string } = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const s = S[lang];
  const baseDir = opts.baseDir ?? process.cwd();
  const stdLabel = isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name;
  const all = findingsForStandard(result, standard);
  const normative = all.filter((f) => !f.advisory);
  const blocking = normative.filter((f) => f.severity === "bloquant").length;
  const rate = runRate(result, standard, lang);
  const grouped = groupFindings(all, standard, lang, baseDir);
  const orphans = unattributedFindings(result).filter((f) => !f.advisory).length;

  const head: string[] = [];
  head.push(`### ${s.title} — ${stdLabel}`, "");
  head.push(blocking ? s.verdictFail(blocking) : normative.length ? s.verdictWarn : s.verdictPass, "");
  head.push(`\`${result.date}\` · ${result.scope.files} ${s.files} · **${rate.text}** ${s.rate}`, "");
  if (rate.agentRuled) head.push(`> ${agentMarkNote(lang)}`, "");
  if (orphans) head.push(`> ${s.unattributed(orphans)}`, "");

  const tail: string[] = [];
  if (opts.artifactName) tail.push(s.artifact(opts.artifactName), "");
  if (opts.runUrl) tail.push(s.runLink(opts.runUrl), "");

  // WHOLE ROWS, never a slice of the finished string. Cutting a rendered document at a byte
  // offset can land mid-row — GFM then renders a broken table — or inside an unterminated
  // fence, where it swallows everything after it. So the body is assembled from a row count
  // that comes down until the whole document fits, and the verdict, the rate and the link are
  // never candidates: a comment that fits but says nothing about where to look is worse than
  // no comment at all.
  const assemble = (rows: number): string => {
    const body: string[] = [];
    if (grouped.length) {
      body.push(s.grouped(grouped.length, all.length), "");
      body.push(...groupTable(grouped.slice(0, rows), s), "");
      const omitted = grouped.length - rows;
      if (omitted > 0) body.push(rows < COMMENT_ROWS ? s.clamped(omitted) : s.moreGroups(omitted), "");
    }
    return [...head, ...body, ...tail].join("\n").trimEnd();
  };

  let rows = Math.min(COMMENT_ROWS, grouped.length);
  while (rows > 0 && assemble(rows).length > COMMENT_LIMIT) rows--;
  return assemble(rows);
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
  // The summary has a 1 MiB budget: it never clamps, and passes every page.
  return [`### ${s.perPage}`, "", ...scoreboardTable(derived, s, lang), "", ...basisCaveats(result, derived, s, lang)].join("\n");
}

/** The scoreboard's rows. Extracted so the job summary and the page-by-page pull-request
 *  comment draw ONE table from one projection — a second copy of this loop is a second chance
 *  to disagree about what a page's rate is. */
function scoreboardTable(derived: PageResult[], s: (typeof S)[Lang], lang: Lang): string[] {
  const out: string[] = [`| ${s.page} | ${s.basis} | ${s.pageRate} | 🔴 | 🟠 | 🟡 |`, "| --- | --- | ---: | ---: | ---: | ---: |"];
  for (const pg of derived) {
    const n = (sev: Severity): number => severityCount(pg, sev);
    out.push(
      `| ${pg.name}${pg.auth ? " 🔒" : ""} — \`${pg.url}\` | ${basisLabel(pg.basis, lang)} | ${formatRate(pg.conformancePct, pg.decided, pg.total)} | ${n("bloquant")} | ${n("majeur")} | ${n("mineur")} |`,
    );
  }
  return out;
}

function severityCount(pg: PageResult, sev: Severity): number {
  return pg.findings.filter((f) => !f.advisory && f.severity === sev).length;
}

/** The caveats a scoreboard must carry: findings no page could claim, and every basis weaker
 *  than a snapshot actually present. One caveat per basis, from the shared sentences — a
 *  « non audité » page must not be explained by the note that asserts it has no snapshot. */
function basisCaveats(result: AuditResult, derived: PageResult[], s: (typeof S)[Lang], lang: Lang): string[] {
  const out: string[] = [];
  const orphans = unattributedFindings(result).filter((f) => !f.advisory).length;
  if (orphans) out.push(`> ${s.unattributed(orphans)}`, "");
  if (derived.some((p) => p.basis === "attributed")) out.push(`> ${s.sourceBasis}`, "");
  const notAudited = pageBasisWarning("not-audited", lang);
  if (notAudited && derived.some((p) => p.basis === "not-audited")) out.push(`> ${notAudited}`, "");
  return out;
}

/** One page's collapsed block: its severity counts in the summary line, its standing as the
 *  shared tally sentence, and the criteria that are actually NON-CONFORMING.
 *
 *  Only the NC rows. A per-page norm has ~106 criteria and a sample has dozens of pages: the
 *  full grid is thousands of rows, which is why it is an artifact and not a comment. What a
 *  reviewer needs inline is which pages fail and on what — the tally line carries the rest
 *  (conforming, not applicable, and how many nobody has ruled on yet) without pretending the
 *  undecided ones are fine. */
function pageBlock(result: AuditResult, page: PageResult, standard: StandardId, lang: Lang): string | undefined {
  const s = S[lang];
  const rows = pageCriterionRows(result, page, standard, lang);
  const nc = rows.filter((r) => r.status === "NC");
  const occurrences = page.findings.filter((f) => !f.advisory).length;
  if (!nc.length && !occurrences) return undefined;
  const cell = (v: string): string => v.replace(/\|/g, "\\|");
  const counts = `🔴 ${severityCount(page, "bloquant")} · 🟠 ${severityCount(page, "majeur")} · 🟡 ${severityCount(page, "mineur")}`;
  const withTests = nc.some((r) => r.tests.length);
  const out: string[] = [
    "<details>",
    `<summary><b>${cell(page.name)}</b>${page.auth ? " 🔒" : ""} — ${counts}</summary>`,
    // GFM only renders Markdown inside <details> after a blank line; without it the table
    // ships to the reader as literal pipes.
    "",
    `${pageTallyNote(pageTally(rows), lang)}`,
    "",
  ];
  // The summary line counts OCCURRENCES; the table below lists CRITERIA. They are two
  // projections, and they can legitimately disagree: a finding whose rule sits outside every
  // criterion's applicability under this standard is counted and decides nothing. Left
  // unsaid, that page shows « 🟠 1 » over an empty block and the reader is owed an
  // explanation rather than an inference.
  if (!nc.length) {
    out.push(s.noCriterionForFindings(occurrences), "", "</details>");
    return out.join("\n");
  }
  out.push(withTests ? `| ${s.criterion} | ${s.testsCol} |` : `| ${s.criterion} |`, withTests ? "| --- | --- |" : "| --- |");
  for (const r of nc) {
    out.push(withTests ? `| ${cell(r.label)} | ${r.tests.map((t) => `\`${t}\``).join(" ")} |` : `| ${cell(r.label)} |`);
  }
  out.push("", "</details>");
  return out.join("\n");
}

/** The PAGE-BY-PAGE pull-request comment.
 *
 *  A second document under a second marker, for a second tier. The digest above answers
 *  "what is broken in this diff"; this one answers "which pages conform, and on which
 *  criteria" — the question a per-page standard like RGAA is actually written in. They cannot
 *  share a sticky, and they did: the sweep's 337 files and 684 occurrences overwrote the four
 *  actionable findings of the code gate on every run, which is why the sweep was muzzled
 *  rather than fixed.
 *
 *  Nothing is decided here either. The scoreboard is the projection the job summary draws,
 *  and each page's non-conformities come from `pageCriterionRows` — the very rows the per-page
 *  sheet renders into the artifact. */
export function pagesComment(result: AuditResult, opts: AnnotateOptions & { runUrl?: string; artifactName?: string } = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const s = S[lang];
  const stdLabel = isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name;
  const redirected = result.scope.redirected ?? [];
  const scope = pagesOf(result);

  const head: string[] = [`### ${s.title} — ${stdLabel} · ${s.pageByPage}`, ""];
  const tail: string[] = [];
  if (opts.artifactName) tail.push(s.artifact(opts.artifactName), "");
  if (opts.runUrl) tail.push(s.runLink(opts.runUrl), "");

  // No page in scope is not a clean report, it is an ABSENT one. Saying so is what tells a
  // reviewer the tier ran at all — silence here reads as "nothing to report".
  if (!scope.length) {
    head.push(s.noPages, "");
    if (redirected.length) head.push(...renderRedirected(redirected, lang), "");
    return [...head, ...tail].join("\n").trimEnd();
  }

  attributePages(result, scope);
  const derived = derivePages(result, scope);
  const normative = findingsForStandard(result, standard).filter((f) => !f.advisory);
  const blocking = normative.filter((f) => f.severity === "bloquant").length;
  const rate = runRate(result, standard, lang);

  head.push(blocking ? s.verdictFail(blocking) : normative.length ? s.verdictWarn : s.verdictPass, "");
  head.push(`\`${result.date}\` · ${s.pagesCount(derived.length)} · **${rate.text}** ${s.rate}`, "");
  if (rate.agentRuled) head.push(`> ${agentMarkNote(lang)}`, "");

  // Worst first, so the pages the size clamp drops are the least severe ones.
  const blocks = [...derived]
    .sort(
      (a, b) =>
        severityCount(b, "bloquant") - severityCount(a, "bloquant") ||
        severityCount(b, "majeur") - severityCount(a, "majeur") ||
        severityCount(b, "mineur") - severityCount(a, "mineur"),
    )
    .map((p) => pageBlock(result, p, standard, lang))
    .filter((b): b is string => b !== undefined);

  // WHOLE blocks and WHOLE rows, never a slice of the finished string — cutting a rendered
  // document at a byte offset lands mid-row and GFM then renders a broken table. The detail
  // goes first because the scoreboard is the half that cannot be reconstructed from the
  // artifact link alone.
  const assemble = (nBlocks: number, nRows: number): string => {
    const body: string[] = [...scoreboardTable(derived.slice(0, nRows), s, lang), ""];
    if (nRows < derived.length) body.push(s.scoreboardClamped(derived.length - nRows), "");
    body.push(...basisCaveats(result, derived, s, lang));
    if (redirected.length) body.push(...renderRedirected(redirected, lang), "");
    if (blocks.length) {
      body.push(`> ${s.pagesDetailNote}`, "");
      body.push(...blocks.slice(0, nBlocks).flatMap((b) => [b, ""]));
      if (nBlocks < blocks.length) body.push(s.pagesClamped(blocks.length - nBlocks), "");
    }
    return [...head, ...body, ...tail].join("\n").trimEnd();
  };

  let nBlocks = blocks.length;
  let nRows = derived.length;
  while (nBlocks > 0 && assemble(nBlocks, nRows).length > COMMENT_LIMIT) nBlocks--;
  while (nRows > 0 && assemble(nBlocks, nRows).length > COMMENT_LIMIT) nRows--;
  return assemble(nBlocks, nRows);
}
