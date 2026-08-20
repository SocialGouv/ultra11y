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
import { packReportGroups, renderPackReport, renderReport, reportCoverage, reportGroups, splitReportSections } from "./report.js";
import type { AuditResult, Finding, Lang, PageResult, Severity, Status } from "./types.js";
import { isUrlPath, repoRelative } from "./util.js";
import {
  agentMarkNote,
  attributePages,
  basisLabel,
  derivePages,
  formatRate,
  pageBasisWarning,
  pageGridModel,
  pagesOf,
  renderRedirected,
  unattributedFindings,
} from "./pages.js";
import { pageCriterionRows, pageTally, pageTallyNote } from "./pages-report.js";
import { mdText } from "./md.js";
import type { CommentKind } from "./pr-comment.js";

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
    pageCriteriaTitle: (name: string) => `${name} — le détail critère par critère`,
    conformingList: "Conformes",
    nonConformingList: "Non conformes",
    toAssessList: "À évaluer",
    naList: "Non applicables",
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
    sectionsDropped: (names: string[]) =>
      `_Sections retirées de ce commentaire pour tenir dans la limite de GitHub (64 Kio), en entier et jamais tronquées : ${names
        .map((n) => `**${n}**`)
        .join(" · ")}. Elles sont dans le rapport de l'artefact, à l'identique._`,
    unanchored: (n: number) => `${n} constat(s) rattaché(s) à une URL, sans ligne de code à annoter — voir le rapport.`,
    unattributed: (n: number) =>
      `${n} constat(s) ne sont rattachés à aucune page (code partagé, fichier hors routes) — comptés dans l'audit global, jamais répartis d'office.`,
    sourceBasis:
      "Une page marquée « source » n'a pas d'instantané : l'absence de constat n'y vaut PAS conformité. Ses critères non décidés restent « à évaluer », ils ne basculent jamais en conformes par silence.",
    pageByPage: "page par page",
    pagesCount: (n: number) => `${n} page(s)`,
    testsCol: "Tests",
    conformingCol: "C",
    nonConformingCol: "NC",
    scoreboardNote:
      "`C` conforme · `NC` non conforme. Pas de pourcentage ici : un taux calculé sur les seuls critères décidés se lit comme une note de page, et vaut la même chose sur une bonne page que sur une mauvaise. Le taux et sa couverture sont dans la fiche par page de l'artefact.",
    undecidedTitle: "Critères non tranchés",
    undecidedNote:
      "Ces critères ne sont NI conformes NI non conformes : personne ne les a encore tranchés, donc ils ne comptent nulle part ci-dessus. Un bilan page par page n'est complet que lorsque cette section est vide — adjugez-les (`verify --manual`), mesurez-les (`scan`), ou déclarez-les dans le fichier `undecidable` avec leur motif.",
    undecidedAllPages: (n: number) => `Sur **toutes** les pages : ${n} critère(s).`,
    blockingNc: "🔴 Non-conformités bloquantes",
    nonBlockingNc: "🟠🟡 Non-conformités non bloquantes",
    noBlockingNc: "Aucune non-conformité bloquante sur cette page.",
    orphansTitle: "Constats rattachés à aucune page",
    orphansNote:
      "Code partagé, ou fichier hors de toute route : rien ne dit sur quelle page ils se manifestent, donc ils ne sont jamais répartis d'office. Ils comptent dans l'audit global et se corrigent comme les autres.",
    noPages:
      "Aucune page dans le périmètre de ce run : le balayage n'a produit aucun instantané. Ce n'est pas un bilan vide, c'est un bilan absent — les critères au rendu restent à évaluer.",
    pagesDetailNote:
      "Un bloc par page portant au moins une non-conformité, et seulement ses critères **non conformes** — la grille complète (tous les critères de chaque page, avec leurs tests et leurs captures) vit dans l'artefact.",
    pagesClamped: (n: number) =>
      `_Le détail de ${n} page(s) a été retiré de ce commentaire pour tenir dans la limite de GitHub — l'artefact les porte toutes._`,
    scoreboardClamped: (n: number) => `_${n} page(s) retirée(s) du tableau pour tenir dans la limite de GitHub — l'artefact les porte toutes._`,
    pageDefects: "Défauts",
    fullGrid: "Grille complète — chaque critère du référentiel, page par page",
    allDefects: "Défauts distincts — où corriger",
    allDefectsNote:
      "Un défaut distinct = une (règle, critère, sélecteur) ; les occurrences répétées sont repliées. C'est la moitié « actionnable » du digest, reprise ici pour que ce commentaire soit le seul à lire.",
    gridLegend: "`C` conforme · `NC` non conforme · `—` non applicable · `?` à évaluer",
    gridDropped: "_La grille complète ne tient pas dans un commentaire GitHub (64 Kio) — elle est dans la fiche par page du livrable._",
    pageMoreDefects: (n: number) => `_… et ${n} autre(s) défaut(s) distinct(s) sur cette page — voir la fiche de page dans l'artefact._`,
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
    pageCriteriaTitle: (name: string) => `${name} — criterion by criterion`,
    conformingList: "Conforming",
    nonConformingList: "Non-conforming",
    toAssessList: "To assess",
    naList: "Not applicable",
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
    sectionsDropped: (names: string[]) =>
      `_Sections dropped from this comment to fit GitHub's 64 KiB limit, whole and never truncated: ${names
        .map((n) => `**${n}**`)
        .join(" · ")}. They are in the artifact's report, identical._`,
    unanchored: (n: number) => `${n} finding(s) keyed to a URL, with no code line to annotate — see the report.`,
    unattributed: (n: number) =>
      `${n} finding(s) are attributed to no page (shared code, file outside any route) — counted in the overall audit, never spread across pages.`,
    sourceBasis:
      'A page marked "source" has no snapshot: the absence of a finding there does NOT mean conforming. Its undecided criteria stay “to assess”; they never turn conforming by silence.',
    pageByPage: "page by page",
    pagesCount: (n: number) => `${n} page(s)`,
    testsCol: "Tests",
    conformingCol: "C",
    nonConformingCol: "NC",
    scoreboardNote:
      "`C` conforming · `NC` non-conforming. No percentage here: a rate over the decided criteria alone reads as a page score, and reads the same on a good page as on a bad one. The rate and its coverage live in the artifact's per-page sheet.",
    undecidedTitle: "Undecided criteria",
    undecidedNote:
      "These are NEITHER conforming NOR non-conforming: nobody has ruled on them yet, so they count nowhere above. A page-by-page report is complete only when this section is empty — adjudicate them (`verify --manual`), measure them (`scan`), or declare them in the `undecidable` file with their reason.",
    undecidedAllPages: (n: number) => `On **every** page: ${n} criterion(ia).`,
    blockingNc: "🔴 Blocking non-conformities",
    nonBlockingNc: "🟠🟡 Non-blocking non-conformities",
    noBlockingNc: "No blocking non-conformity on this page.",
    orphansTitle: "Findings attributed to no page",
    orphansNote:
      "Shared code, or a file outside every route: nothing says which page they show up on, so they are never spread across pages. They count in the overall audit and are fixed like any other.",
    noPages:
      "No page in this run's scope: the sweep produced no snapshot. This is not an empty scoreboard, it is a missing one — the rendering criteria stay to assess.",
    pagesDetailNote:
      "One block per page carrying at least one non-conformity, and only its **non-conforming** criteria — the full grid (every criterion of every page, with its tests and its screenshot) lives in the artifact.",
    pagesClamped: (n: number) => `_The detail of ${n} page(s) was dropped from this comment to fit GitHub's limit — the artifact carries them all._`,
    scoreboardClamped: (n: number) => `_${n} page(s) dropped from the table to fit GitHub's limit — the artifact carries them all._`,
    pageDefects: "Defects",
    fullGrid: "Full grid — every criterion of the standard, page by page",
    allDefects: "Distinct defects — where to fix",
    allDefectsNote:
      "One distinct defect = one (rule, criterion, selector); repeated occurrences are folded. This is the digest's actionable half, carried here so this comment is the only one to read.",
    gridLegend: "`C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess",
    gridDropped: "_The full grid does not fit in a GitHub comment (64 KiB) — it is in the deliverable's per-page sheet._",
    pageMoreDefects: (n: number) => `_… and ${n} more distinct defect(s) on this page — see its sheet in the artifact._`,
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

/** The size GitHub actually measures. A French RGAA comment is ~4 % larger in UTF-8 than in
 *  UTF-16 code units — every « é », every em dash, every severity emoji — so a document that
 *  fits `.length` can still be 66 KB on the wire. Counting the encoded bytes is the
 *  conservative reading of the same limit, and it can only ever make the clamp bite sooner. */
const BYTES = new TextEncoder();
function sizeOf(s: string): number {
  return BYTES.encode(s).length;
}

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
  return `| ${ICON[g.severity]} ${g.severity} | ${cell(g.criterion)} | \`${cell(g.where)}\` (\`${cell(g.selectorHint)}\`) | ${cell(mdText(g.message))} | ${g.occurrences} | ${g.pages || "—"} |`;
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

/** THE COMMENT'S BODY IS THE REPORT'S OWN SECTIONS.
 *
 *  A pull-request comment used to be a document of its own — a digest, written separately from
 *  the audit it summarised. Two documents about one run drift, and a reader who opens the
 *  artifact after reading the comment should recognise what they are looking at.
 *
 *  So the body is the report, rendered once and split into its `##` sections, kept in report
 *  order while the budget lasts. What does not fit is dropped WHOLE and NAMED — a heading a
 *  reader can go and find in the artifact — never sliced at a byte offset, which lands
 *  mid-table or inside a fence.
 *
 *  The report's own preamble is skipped: the comment's head already carries the date, the
 *  scope and the rate, and says them in the verdict's voice.
 *
 *  `budget` is what is left after the head and the tail, both of which are never candidates
 *  for dropping — a comment that fits but says nothing about where to look is worse than no
 *  comment at all. */
function reportSectionsBody(
  result: AuditResult,
  standard: StandardId,
  lang: Lang,
  budget: number,
  /** Headings to take FIRST, still in report order. Not a reordering of the audit: the two
   *  comments answer different questions of the same document, and the one that answers
   *  "which pages conform" must not lose the page sections to a budget spent on the defect
   *  list. What is dropped is named either way. */
  prefer?: RegExp,
): { body: string[]; dropped: string[] } {
  let md: string;
  try {
    md = isCore(standard) ? renderReport(result, lang) : renderPackReport(result, loadPack(standard), lang);
  } catch {
    // A rendering failure must never cost the comment. The caller still has its head and tail,
    // which carry the verdict and the link — the two things a reviewer cannot do without.
    return { body: [], dropped: [] };
  }
  const { sections } = splitReportSections(md);
  const ordered = prefer ? [...sections.filter((x) => prefer.test(x.heading)), ...sections.filter((x) => !prefer.test(x.heading))] : sections;
  const body: string[] = [];
  const dropped: string[] = [];
  let spent = 0;
  for (const section of ordered) {
    const text = section.text.trimEnd();
    // +2 for the blank line that joins it to what precedes.
    if (dropped.length || spent + sizeOf(text) + 2 > budget) {
      dropped.push(section.heading.replace(/^##\s*/, ""));
      continue;
    }
    body.push(text, "");
    spent += sizeOf(text) + 2;
  }
  return { body, dropped };
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
  // The body is the REPORT's own sections — same document, same words, same order — kept while
  // the budget lasts and dropped whole otherwise. The head and the tail are never candidates.
  const fixed = sizeOf([...head, ...tail].join("\n"));
  const { body, dropped } = reportSectionsBody(result, standard, lang, Math.max(0, COMMENT_LIMIT - fixed - 512));
  const notes: string[] = [];
  if (dropped.length) notes.push(s.sectionsDropped(dropped), "");

  const assembled = [...head, ...body, ...notes, ...tail].join("\n").trimEnd();
  if (sizeOf(assembled) <= COMMENT_LIMIT) return assembled;

  // The report could not be cut small enough — a single section larger than the whole budget.
  // Fall back to the digest this comment carried before: the distinct defects and a link, which
  // is the least a reviewer needs. Never a byte-slice of the report.
  const assemble = (rows: number): string => {
    const digest: string[] = [];
    if (grouped.length) {
      digest.push(s.grouped(grouped.length, all.length), "");
      digest.push(...groupTable(grouped.slice(0, rows), s), "");
      const omitted = grouped.length - rows;
      if (omitted > 0) digest.push(rows < COMMENT_ROWS ? s.clamped(omitted) : s.moreGroups(omitted), "");
    }
    return [...head, ...digest, ...tail].join("\n").trimEnd();
  };
  let rows = Math.min(COMMENT_ROWS, grouped.length);
  while (rows > 0 && sizeOf(assemble(rows)) > COMMENT_LIMIT) rows--;
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
  return [
    `### ${s.perPage}`,
    "",
    ...scoreboardTable(result, derived, standard, s, lang),
    "",
    ...basisCaveats(result, derived, s, lang),
    ...derived.flatMap((pg) => [...namedCriteriaBlock(result, pg, standard, s, lang), ""]),
  ].join("\n");
}

/** WHICH criteria, not how many — one folded block per page.
 *
 *  The scoreboard beside it counts, and counting is the right shape for a scoreboard: three
 *  numbers a reader cannot misread. It is the wrong shape for acting. « 65 / 6 » on a row says
 *  nothing about which six, and the ids lived only in the artifact — which means, in practice,
 *  nowhere: a reviewer reads the job summary and does not download a 4 MB zip to find out that
 *  the six are 3.2, 3.3, 10.4, 10.11, 10.12 and 12.8.
 *
 *  Every status comes from `pageCriterionRows` — the very rows the artifact's per-page sheet
 *  renders — so the summary and the deliverable cannot disagree about a single cell. Ids only,
 *  not titles: this is an index into the report, and 106 titles per page is a wall.
 *
 *  The conforming list is here for the same reason the full grid is in the comment: under a
 *  per-page norm most of the deliverable IS what conforms, and a document that shows only
 *  failures cannot be read as a statement of conformity at all. */
function namedCriteriaBlock(result: AuditResult, page: PageResult, standard: StandardId, s: (typeof S)[Lang], lang: Lang): string[] {
  const rows = pageCriterionRows(result, page, standard, lang);
  if (!rows.length) return [];
  const ids = (status: Status): string[] => rows.filter((r) => r.status === status).map((r) => `\`${r.id}\``);
  const line = (label: string, list: string[]): string[] => (list.length ? [`- **${label}** (${list.length}) : ${list.join(" · ")}`] : []);
  return [
    "<details>",
    `<summary>${s.pageCriteriaTitle(page.name)}${page.auth ? " 🔒" : ""}</summary>`,
    // GFM only renders Markdown inside <details> after a blank line; without it the list
    // ships to the reader as one run-on paragraph.
    "",
    // Failures first — that is the work — then what stands, then what nobody has ruled on.
    ...line(s.nonConformingList, ids("NC")),
    ...line(s.conformingList, ids("C")),
    ...line(s.toAssessList, ids("manual")),
    ...line(s.naList, ids("NA")),
    "",
    "</details>",
  ];
}

/** The scoreboard's rows. Extracted so the job summary and the page-by-page pull-request
 *  comment draw ONE table from one projection — a second copy of this loop is a second chance
 *  to disagree about what a page's rate is.
 *
 *  COUNTS, not a percentage. Every status comes from `pageCriterionRows`, in the ACTIVE
 *  standard's vocabulary — `PageResult.conformancePct` is always WCAG-keyed and would report a
 *  pack page against the core's 55.
 *
 *  A percentage was worse than useless here. When the judgment criteria are undecided — which
 *  is the NORMAL state without an adjudication pass, and the state a rejected one falls back to
 *  — a page has 2 conforming and 2 non-conforming out of 106, and the cell read « 50 % (4/106) »
 *  on every row. Half of four criteria is not half a page, but the eye reads a page score, and
 *  it read the same score for a good page and a bad one. The three counts cannot be misread:
 *  what conforms, what does not, and how much nobody has ruled on yet. The percentage stays in
 *  the artifact's per-page sheet, next to the coverage sentence that qualifies it. */
function scoreboardTable(result: AuditResult, derived: PageResult[], standard: StandardId, s: (typeof S)[Lang], lang: Lang): string[] {
  const out: string[] = [
    `| ${s.page} | ${s.basis} | ${s.conformingCol} | ${s.nonConformingCol} | 🔴 | 🟠 | 🟡 |`,
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const pg of derived) {
    const n = (sev: Severity): number => severityCount(pg, sev);
    const t = pageTally(pageCriterionRows(result, pg, standard, lang));
    out.push(
      `| ${pg.name}${pg.auth ? " 🔒" : ""} — \`${pg.url}\` | ${basisLabel(pg.basis, lang)} | ${t.c} | ${t.nc} | ${n("bloquant")} | ${n("majeur")} | ${n("mineur")} |`,
    );
  }
  return out;
}

/** THE CRITERIA NOBODY HAS RULED ON — named, not counted in a column.
 *
 *  The scoreboard used to carry an « À évaluer » number per page, and a number in a column is
 *  something a reader learns to skip: measured on a real sweep, every row said 9 and the report
 *  shipped for weeks without anyone acting on it. A page-by-page verdict is only complete when
 *  nothing is undecided, so the honest rendering is not a third column — it is a block that
 *  disappears entirely when the grid is full, and NAMES what is open when it is not.
 *
 *  Criteria open on EVERY page are stated once. Under a per-page norm that is the usual shape
 *  (a criterion the engine cannot decide is undecided everywhere), and repeating it on
 *  thirty-seven rows is how a short, actionable list becomes a wall. */
function undecidedBlock(result: AuditResult, derived: PageResult[], standard: StandardId, s: (typeof S)[Lang], lang: Lang): string[] {
  const perPage = derived.map((pg) => ({
    page: pg,
    open: pageCriterionRows(result, pg, standard, lang)
      .filter((r) => r.status === "manual")
      .map((r) => r.id),
  }));
  if (!perPage.some((p) => p.open.length)) return [];
  const everywhere = perPage[0]!.open.filter((id) => perPage.every((p) => p.open.includes(id)));
  const out: string[] = [`> ⚠️ **${s.undecidedTitle}** — ${s.undecidedNote}`, ""];
  if (everywhere.length) out.push(`- ${s.undecidedAllPages(everywhere.length)} ${everywhere.map((id) => `\`${id}\``).join(" · ")}`);
  for (const { page, open } of perPage) {
    const own = open.filter((id) => !everywhere.includes(id));
    if (own.length) out.push(`- **${page.name}** : ${own.map((id) => `\`${id}\``).join(" · ")}`);
  }
  out.push("");
  return out;
}

function severityCount(pg: PageResult, sev: Severity): number {
  return pg.findings.filter((f) => !f.advisory && f.severity === sev).length;
}

/** The caveats a scoreboard must carry: findings no page could claim, and every basis weaker
 *  than a snapshot actually present. One caveat per basis, from the shared sentences — a
 *  « non audité » page must not be explained by the note that asserts it has no snapshot. */
function basisCaveats(result: AuditResult, derived: PageResult[], s: (typeof S)[Lang], lang: Lang): string[] {
  // What the three count columns mean, and why there is no percentage beside them.
  const out: string[] = [`> ${s.scoreboardNote}`, ""];
  const orphans = unattributedFindings(result).filter((f) => !f.advisory).length;
  if (orphans) out.push(`> ${s.unattributed(orphans)}`, "");
  if (derived.some((p) => p.basis === "attributed")) out.push(`> ${s.sourceBasis}`, "");
  const notAudited = pageBasisWarning("not-audited", lang);
  if (notAudited && derived.some((p) => p.basis === "not-audited")) out.push(`> ${notAudited}`, "");
  return out;
}

/** Distinct defects shown under one page before the block says how many it held back.
 *
 *  Distinct, not occurrences — the grouping already folded the repeats. Six is what fits
 *  beside the criterion table without turning a 35-page comment into something nobody scrolls,
 *  and the ones held back are counted rather than dropped in silence. */
const PAGE_DEFECTS_SHOWN = 6;

/** One page's collapsed block: its severity counts in the summary line, its standing as the
 *  shared tally sentence, and the criteria that are actually NON-CONFORMING.
 *
 *  Only the NC rows. A per-page norm has ~106 criteria and a sample has dozens of pages: the
 *  full grid is thousands of rows, which is why it is an artifact and not a comment. What a
 *  reviewer needs inline is which pages fail and on what — the tally line carries the rest
 *  (conforming, not applicable, and how many nobody has ruled on yet) without pretending the
 *  undecided ones are fine. */
function pageBlock(result: AuditResult, page: PageResult, standard: StandardId, lang: Lang, baseDir: string): string | undefined {
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

  // WHAT TO CHANGE, not only what was failed.
  //
  // The rows above name the criterion; a criterion is the norm, not the work. Measured on a
  // real pull request: 506 lines, 35 pages, every non-conforming criterion listed — and not
  // one file, line, selector or description of the defect anywhere in the document. A
  // reviewer read « les couleurs sont-elles suffisamment contrastées ? » and had to download
  // a 4 MB artifact to find out which element. The digest comment has carried location and
  // defect since it existed; this is the same audit read page-first, and there is no reason
  // for it to be the half that says nothing.
  //
  // Grouped, never listed: one design-system defect repeated on twenty rows is ONE thing to
  // fix, and twenty identical lines is how a comment becomes unreadable and then gets muzzled.
  // BLOCKING FIRST, AND SEPARATELY. A single table sorted by severity reads as one list of
  // things to do, and the reader has to check an icon on every row to find the ones that
  // actually stop a user. They are different work — a blocking non-conformity is a page
  // somebody cannot use — so they get their own heading, and the clamp below can never take
  // one: it comes off the non-blocking half first, and off the blocking half never.
  const defects = groupFindings(
    page.findings.filter((f) => !f.advisory),
    standard,
    lang,
    baseDir,
  );
  const blocking = defects.filter((g) => g.severity === "bloquant");
  const rest = defects.filter((g) => g.severity !== "bloquant");
  // BLOCKING SERVED FIRST, out of one budget. The cap is what keeps a 40-defect page from
  // burying the other thirty-six, and it stays — what changes is WHO it takes from: the
  // blocking half draws first, and only the remainder is offered to the rest. Each half says
  // what it held back, so neither ever trails off in silence.
  const shownBlocking = Math.min(blocking.length, PAGE_DEFECTS_SHOWN);
  const shownRest = Math.min(rest.length, Math.max(0, PAGE_DEFECTS_SHOWN - shownBlocking));
  const half = (rows: FindingGroup[], shown: number, title: string): string[] => {
    if (!rows.length) return [];
    const lines = [
      "",
      `**${title}**`,
      "",
      `| ${s.severity} | ${s.where} | ${s.what} | ${s.occurrences} |`,
      "| --- | --- | --- | ---: |",
      ...rows
        .slice(0, shown)
        .map(
          (g) => `| ${ICON[g.severity]} ${g.severity} | \`${cell(g.where)}\` (\`${cell(g.selectorHint)}\`) | ${cell(mdText(g.message))} | ${g.occurrences} |`,
        ),
    ];
    if (rows.length > shown) lines.push("", s.pageMoreDefects(rows.length - shown));
    return lines;
  };
  out.push(...half(blocking, shownBlocking, s.blockingNc), ...half(rest, shownRest, s.nonBlockingNc));
  out.push("", "</details>");
  return out.join("\n");
}

/** The whole criterion × page grid, collapsed — every criterion of the standard, and where
 *  each page stands on it.
 *
 *  The scoreboard says HOW MANY criteria a page conforms to and the per-page blocks say which
 *  ones it FAILS; between the two, the criteria a page CONFORMS to were never named. Under a
 *  per-page norm that is most of the deliverable, and a reviewer asking « which of the 106 does
 *  this page pass? » had to download the artifact to find out.
 *
 *  Drawn from `pageGridModel`, the same projection the artifact and the HTML use. A surface
 *  that recomputes a status is a surface that will eventually disagree with the report. */
function fullGridBlock(result: AuditResult, derived: PageResult[], standard: StandardId, s: (typeof S)[Lang], lang: Lang): string[] {
  const { rows, status } = pageGridModel(result, derived, standard, lang);
  if (!rows.length || !derived.length) return [];
  const cell = (v: string): string => v.replace(/\|/g, "\\|");
  const head = [s.criterion, ...derived.map((p) => `${cell(p.name)}${p.auth ? " 🔒" : ""}`)];
  const out: string[] = [
    "<details>",
    `<summary><b>${s.fullGrid}</b> — ${rows.length} × ${derived.length}</summary>`,
    // GFM only renders Markdown inside <details> after a blank line.
    "",
    `> ${s.gridLegend}`,
    "",
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    out.push(`| ${cell(row.label)} | ${derived.map((p) => GRID_MARK[status.get(row.id)?.get(p.id) ?? "manual"]).join(" | ")} |`);
  }
  out.push("", "</details>");
  return out;
}

/** THE FINDINGS NO PAGE COULD CLAIM, shown rather than merely counted.
 *
 *  Honesty rule 1 (src/pages.ts) refuses to spread an unattributable finding across pages, so a
 *  page-by-page document has nowhere to put it. Until now it said so in one sentence and left
 *  the defects themselves to the code digest — a SECOND sticky comment. With the digest gone,
 *  that sentence would be the only trace of them: « 6 constats ne sont rattachés à aucune
 *  page », and no file, no line, no description anywhere in the document.
 *
 *  So they get a block of their own, folded, in the same shape as a page's: shared code and
 *  files outside every route are still code somebody has to fix. */
function orphansBlock(result: AuditResult, standard: StandardId, s: (typeof S)[Lang], lang: Lang, baseDir: string): string[] {
  const orphans = unattributedFindings(result).filter((f) => !f.advisory);
  if (!orphans.length) return [];
  const cell = (v: string): string => v.replace(/\|/g, "\\|");
  const groups = groupFindings(orphans, standard, lang, baseDir);
  const counts = SEV_ORDER.map((sev) => `${ICON[sev]} ${orphans.filter((f) => f.severity === sev).length}`).join(" · ");
  const out: string[] = [
    "<details>",
    `<summary><b>${s.orphansTitle}</b> — ${counts}</summary>`,
    // GFM only renders Markdown inside <details> after a blank line.
    "",
    `> ${s.orphansNote}`,
    "",
    `| ${s.severity} | ${s.criterion} | ${s.where} | ${s.what} | ${s.occurrences} |`,
    "| --- | --- | --- | --- | ---: |",
  ];
  for (const g of groups.slice(0, MAX_ROWS)) {
    out.push(
      `| ${ICON[g.severity]} ${g.severity} | ${cell(g.criterion)} | \`${cell(g.where)}\` (\`${cell(g.selectorHint)}\`) | ${cell(mdText(g.message))} | ${g.occurrences} |`,
    );
  }
  if (groups.length > MAX_ROWS) out.push("", s.more(groups.length - MAX_ROWS));
  out.push("", "</details>");
  return out;
}

/** EVERY DISTINCT DEFECT OF THE RUN, folded — the digest's actionable half, in the page
 *  document.
 *
 *  `kind: "full"` exists because the two comments are each true and neither is the whole
 *  thing: `digest` says what is broken and where, `pages` says which pages conform and on
 *  which criteria, and a workflow that wants both posts two stickies a reviewer must
 *  reconcile. The page blocks above already carry each page's own defects; this block carries
 *  the run's, including the ones no page could claim, so the document answers "where do I go
 *  and change something?" without a second comment.
 *
 *  Same grouping, same columns and same cap as the job summary's table — one implementation of
 *  "a distinct defect", so the two surfaces cannot disagree about how many there are. */
function allDefectsBlock(result: AuditResult, standard: StandardId, s: (typeof S)[Lang], lang: Lang, baseDir: string): string[] {
  const all = findingsForStandard(result, standard).filter((f) => !f.advisory);
  if (!all.length) return [];
  const cell = (v: string): string => v.replace(/\|/g, "\\|");
  const groups = groupFindings(all, standard, lang, baseDir);
  const counts = SEV_ORDER.map((sev) => `${ICON[sev]} ${all.filter((f) => f.severity === sev).length}`).join(" · ");
  const out: string[] = [
    "<details>",
    `<summary><b>${s.allDefects}</b> — ${groups.length} / ${all.length} · ${counts}</summary>`,
    // GFM only renders Markdown inside <details> after a blank line.
    "",
    `> ${s.allDefectsNote}`,
    "",
    `| ${s.severity} | ${s.criterion} | ${s.where} | ${s.what} | ${s.occurrences} |`,
    "| --- | --- | --- | --- | ---: |",
  ];
  for (const g of groups.slice(0, MAX_ROWS)) {
    out.push(
      `| ${ICON[g.severity]} ${g.severity} | ${cell(g.criterion)} | \`${cell(g.where)}\` (\`${cell(g.selectorHint)}\`) | ${cell(mdText(g.message))} | ${g.occurrences} |`,
    );
  }
  if (groups.length > MAX_ROWS) out.push("", s.more(groups.length - MAX_ROWS));
  out.push("", "</details>");
  return out;
}

/** The marks the grid draws. Same vocabulary as the per-page sheet's. */
const GRID_MARK: Record<Status, string> = { C: "C", NC: "NC", NA: "—", manual: "?" };

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
export function pagesComment(result: AuditResult, opts: AnnotateOptions & { runUrl?: string; artifactName?: string; kind?: CommentKind } = {}): string {
  const standard = opts.standard ?? CORE;
  // `full` is this document plus the digest's actionable half. Anything else renders exactly
  // what `pages` always rendered, byte for byte — a sticky already posted must keep being
  // edited in place, not re-keyed and duplicated.
  const withDefects = opts.kind === "full";
  const lang = opts.lang ?? "en";
  const s = S[lang];
  const baseDir = opts.baseDir ?? process.cwd();
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
    .map((p) => pageBlock(result, p, standard, lang, baseDir))
    .filter((b): b is string => b !== undefined);

  // WHOLE blocks and WHOLE rows, never a slice of the finished string — cutting a rendered
  // document at a byte offset lands mid-row and GFM then renders a broken table. The detail
  // goes first because the scoreboard is the half that cannot be reconstructed from the
  // artifact link alone.
  // THIS COMMENT KEEPS ITS OWN PROJECTION, deliberately — unlike the digest above, which is
  // now the report's own sections verbatim.
  //
  // The report's page sections answer the same question, but not in the form a comment needs,
  // and each difference came from a measured failure: a page is scored in COUNTS because a
  // rate computed over decided-only criteria printed "50 %" on every page, good and bad; the
  // occurrences of one defect are FOLDED because 684 of them once made a wall nobody read; the
  // grid sits behind a `<details>` with a blank line after the summary, without which GFM
  // renders the table as prose. What keeps the two documents one is that both now draw the
  // same per-page rate table from the same helpers (see renderPageRates in src/report.ts), and
  // every status here comes from `pageCriterionRows` — the rows the artifact's sheet renders.
  const assemble = (nBlocks: number, nRows: number, withGrid = true): string => {
    const body: string[] = [...scoreboardTable(result, derived.slice(0, nRows), standard, s, lang), ""];
    if (nRows < derived.length) body.push(s.scoreboardClamped(derived.length - nRows), "");
    body.push(...basisCaveats(result, derived, s, lang));
    // What nobody has ruled on, NAMED. Empty — and therefore invisible — on a complete grid,
    // which is the state this whole document is meant to reach.
    body.push(...undecidedBlock(result, derived, standard, s, lang));
    if (redirected.length) body.push(...renderRedirected(redirected, lang), "");
    // The defects no page could claim. This comment is now the ONLY one posted, so they are
    // shown here or they are shown nowhere.
    body.push(...orphansBlock(result, standard, s, lang, baseDir), "");
    // The full grid, folded away so the scoreboard stays what a reviewer reads first. It is
    // the biggest thing in the document — 106 criteria × 35 pages — so it is also the first
    // thing the size clamp gives up, WHOLE and with a line saying where to find it.
    if (withGrid) body.push(...fullGridBlock(result, derived, standard, s, lang), "");
    else body.push(s.gridDropped, "");
    // The run's distinct defects, under `kind: "full"` only. After the grid so a reviewer
    // meets the verdict before the worklist, and before the per-page blocks because it is the
    // half that says where to go and change something.
    if (withDefects) body.push(...allDefectsBlock(result, standard, s, lang, baseDir), "");
    if (blocks.length) {
      body.push(`> ${s.pagesDetailNote}`, "");
      body.push(...blocks.slice(0, nBlocks).flatMap((b) => [b, ""]));
      if (nBlocks < blocks.length) body.push(s.pagesClamped(blocks.length - nBlocks), "");
    }
    return [...head, ...body, ...tail].join("\n").trimEnd();
  };

  let nBlocks = blocks.length;
  let nRows = derived.length;
  // The grid goes first when it does not fit: it is the one part that is reproducible in full
  // from the artifact, while the scoreboard and the defect blocks are not.
  if (sizeOf(assemble(nBlocks, nRows)) <= COMMENT_LIMIT) return assemble(nBlocks, nRows);
  while (nBlocks > 0 && sizeOf(assemble(nBlocks, nRows, false)) > COMMENT_LIMIT) nBlocks--;
  while (nRows > 0 && sizeOf(assemble(nBlocks, nRows, false)) > COMMENT_LIMIT) nRows--;
  return assemble(nBlocks, nRows, false);
}
