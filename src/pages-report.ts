// THE PER-PAGE REPORT — the deliverable an accessibility auditor actually hands over.
//
// `renderPageGrid` (src/pages.ts) answers "which criteria fail, across the pages?" as one
// matrix. That is the right shape for a diff and the wrong shape for a page owner: with 106
// RGAA criteria over N pages nobody reads a column. What an audit is asked for is a DOSSIER
// PER PAGE — this page, its screenshot, every criterion of the standard with its status, and
// the non-conformities written out in full.
//
// Two invariants hold the file together, and they are why it is not simply "group findings
// by page and print them":
//
//   1. NOTHING IS RE-DECIDED HERE. Every status comes from `derivePages` and, for a country
//      standard, from `derivePackResults(pageView(...))` — the very projection `report` and
//      the grid already use. A second implementation would drift, and the first symptom of
//      drift in an accessibility report is a criterion silently declared conforming.
//   2. THE NON-CONFORMITIES ARE RENDERED BY `renderAuditorUnit`. The auditor conformance
//      block is the central deliverable of this tool; a per-page variant of it would be a
//      second format to keep in sync, and its occurrence lines would stop being parseable by
//      `verify` (AUDITOR_OCCURRENCE, src/verify.ts).
//
// The screenshot is the one thing the page report has that no other output does. It is
// passed in as an href, never resolved here: `.ultra11y/pages/<id>/screen.png` is already
// on disk, and the caller decides whether to reference it relatively or copy it beside the
// report (it does copy, so an uploaded `audits/` artefact keeps its images), which keeps
// this module pure and testable.
import { prdUnits } from "./prd.js";
import { renderAuditorUnit, type AuditorCropLookup } from "./auditor.js";
import { agentMarkNote, basisLabel, formatRate, pageView, unattributedFindings } from "./pages.js";
import { CORE, type StandardId, derivePackResults, isCore, loadPack, packTestIds, themeName, titlePlain } from "./standards/index.js";
import type { AuditResult, Lang, PageResult, Status } from "./types.js";
import { compareSC, scTitle } from "./wcag.js";

/** Marks a file as a PER-PAGE report rather than a conformance report. `check` keys on it to
 *  apply the gates that mean something here (no invented criterion, sane rate) instead of
 *  demanding the §1–5 structure of a conformance document. Without the marker the file would
 *  fail with five misleading "missing section" errors — a confusing refusal, not an explicit
 *  one. */
export const PAGES_REPORT_MARKER = "ultra11y:pages-report";

export function pagesReportMarker(standard: StandardId): string {
  return `<!-- ${PAGES_REPORT_MARKER} v="1" standard="${standard}" -->`;
}

export function isPagesReport(md: string): boolean {
  return md.slice(0, 400).includes(`<!-- ${PAGES_REPORT_MARKER}`);
}

const MARK: Record<Status, string> = { C: "C", NC: "NC", NA: "—", manual: "?" };

const L = {
  fr: {
    docTitle: "Rapport d'accessibilité page par page",
    indexTitle: "Rapport page par page — index",
    date: "Date",
    standard: "Référentiel",
    pagesCount: "Pages",
    page: "Page",
    url: "URL",
    basis: "Base",
    snapshot: "instantané",
    source: "source",
    capturedAt: "Capturé le",
    viewport: "Fenêtre",
    producer: "Producteur",
    auth: "Authentification requise",
    rate: "Taux de réussite automatique (vérifications statiques)",
    // The index has its own, shorter header — the sheet's label is a full sentence and would
    // wreck an eight-column table. Kept as a SEPARATE key: editing `rate` in place would
    // silently reword the sheet bullet too.
    rateShort: "Taux (critères décidés)",
    rateNote: "sous-ensemble décidable : C ÷ (C + NC)",
    tally: (c: number, nc: number, na: number, m: number) => `${c} conforme(s) · ${nc} non conforme(s) · ${na} non applicable(s) · ${m} à évaluer`,
    coverage: (decided: number, total: number) =>
      `Couverture : ${decided}/${total} critère(s) évalué(s) — le taux ci-dessus ne porte que sur eux, et ne dit rien des ${total - decided} autres.`,
    tests: "Tests",
    screenshotAlt: (n: string) => `Capture d'écran de la page ${n}`,
    noScreenshot: "Aucune capture d'écran pour cette page (le producteur n'en a pas fourni) — le tier pixel est donc inactif ici.",
    gridTitle: "Grille des critères",
    gridNote: "`C` conforme · `NC` non conforme · `—` non applicable · `?` à évaluer.",
    criterion: "Critère",
    status: "Statut",
    ncTitle: "Non-conformités",
    recTitle: "Recommandations (non normatives)",
    recNote: "Bonnes pratiques sans test normatif en échec : elles ne rendent aucun critère non conforme et n'entrent pas dans le taux.",
    noNc: "Aucune non-conformité détectée sur cette page par le moteur. Les critères « à évaluer » restent à trancher.",
    sourceWarn:
      "Cette page n'a **pas** d'instantané : ses constats proviennent du code. L'absence de constat n'y vaut donc PAS conformité — les critères non décidés restent « à évaluer ».",
    manualWarn:
      "Un critère « à évaluer » n'est ni conforme ni non conforme : personne ne l'a encore tranché. Les critères de jugement s'adjugent avec `verify --manual`, ceux « à restituer » avec `scan`.",
    unattributed: (n: number) =>
      `${n} constat(s) ne sont rattachés à aucune page (code partagé, fichier hors routes). Ils sont comptés dans l'audit global et ne sont jamais répartis d'office sur les pages.`,
    sheet: "Fiche",
    blocking: "Bloquant",
    major: "Majeur",
    minor: "Mineur",
    indexNote:
      "Une fiche par page. `X % (d/t)` : le taux ne porte que sur les `d` critères décidés sur `t` — il ne dit rien des autres. `—` signifie qu'aucun critère n'a été décidé sur cette page, et ne vaut donc NI conformité NI non-conformité.",
  },
  en: {
    docTitle: "Page-by-page accessibility report",
    indexTitle: "Page-by-page report — index",
    date: "Date",
    standard: "Standard",
    pagesCount: "Pages",
    page: "Page",
    url: "URL",
    basis: "Basis",
    snapshot: "snapshot",
    source: "source",
    capturedAt: "Captured at",
    viewport: "Viewport",
    producer: "Producer",
    auth: "Authentication required",
    rate: "Automatic static-check pass rate",
    rateShort: "Rate (decided criteria)",
    rateNote: "decidable subset: C ÷ (C + NC)",
    tally: (c: number, nc: number, na: number, m: number) => `${c} conforming · ${nc} non-conforming · ${na} not applicable · ${m} to assess`,
    coverage: (decided: number, total: number) =>
      `Coverage: ${decided}/${total} criteria assessed — the rate above covers only those, and says nothing about the other ${total - decided}.`,
    tests: "Tests",
    screenshotAlt: (n: string) => `Screenshot of the ${n} page`,
    noScreenshot: "No screenshot for this page (the producer supplied none) — the pixel tier is therefore inactive here.",
    gridTitle: "Criteria grid",
    gridNote: "`C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess.",
    criterion: "Criterion",
    status: "Status",
    ncTitle: "Non-conformities",
    recTitle: "Recommendations (non-normative)",
    recNote: "Good practices with no failing normative test: they never make a criterion non-conforming and do not enter the rate.",
    noNc: "No non-conformity detected on this page by the engine. The criteria left to assess are still open.",
    sourceWarn:
      "This page has **no** snapshot: its findings come from the code. The absence of a finding therefore does NOT mean conforming — undecided criteria stay “to assess”.",
    manualWarn:
      "A criterion “to assess” is neither conforming nor non-conforming: nobody has ruled on it yet. Judgment criteria are adjudicated with `verify --manual`, needs-rendering ones with `scan`.",
    unattributed: (n: number) =>
      `${n} finding(s) are attributed to no page (shared code, file outside any route). They are counted in the overall audit and are never spread across pages.`,
    sheet: "Sheet",
    blocking: "Blocking",
    major: "Major",
    minor: "Minor",
    indexNote:
      "One sheet per page. `X % (d/t)`: the rate covers only the `d` criteria decided out of `t` — it says nothing about the others. `—` means no criterion was decided on this page, so it is NEITHER conformity NOR non-conformity.",
  },
} as const;

export interface PageReportOpts {
  standard?: StandardId;
  lang?: Lang;
  /** Image `src` for each page id, relative to where THIS file will be written. Resolved by
   *  the caller because only the caller knows the destination path. */
  screenshots?: Map<string, string>;
  /** Heading level of a page's own section. `##` inside a combined document, `#` when the
   *  page owns its file. */
  heading?: string;
  /** The annotated crop illustrating one occurrence, when the evidence tier drew one. Passed
   *  straight through to the auditor block, which owns the one place a crop is emitted. */
  cropFor?: AuditorCropLookup;
  /** What the evidence tier could NOT draw on a page, and why — already localized. Printed
   *  under the screenshot so a reader is never left to infer that an absent image means an
   *  absent defect.
   *
   *  A LOOKUP, not a list, because `renderPagesDocument` renders every page from one opts
   *  object: a list would print one page's refusals under all of them, and the caller that
   *  wanted to avoid that instead passed nothing at all — which is how the combined document
   *  came to carry the crops without the refusals. */
  evidenceNotice?: (pageId: string) => string[];
}

/** One criterion's line on one page's sheet. Exported because the HTML renderer and the CI
 *  digest must project the SAME decisions this sheet projects — a second computation of a
 *  status is a second chance to disagree with the report. */
export interface PageCriterionRow {
  id: string;
  label: string;
  group: string;
  status: Status;
  // The criterion's own numbered tests (pack standards only — the WCAG core's analogue is
  // its techniques, which are advisory rather than the thing you rule on). Rendered in the
  // grid so a sheet says WHAT has to be checked for every criterion, not only for the ones
  // that happened to trigger a non-conformity.
  tests: string[];
  decidedBy?: "engine" | "agent" | "scan";
  /** Conforming because nothing of its kind is on this page — see INAPPLICABLE_STATUS. */
  inapplicable?: boolean;
}

/** The criterion rows for ONE page, in the active standard's own vocabulary and order.
 *  Delegates every status to the shared projection — see invariant 1 at the top. */
export function pageCriterionRows(result: AuditResult, page: PageResult, standard: StandardId, lang: Lang): PageCriterionRow[] {
  if (isCore(standard)) {
    return [...page.criteria]
      .sort((a, b) => compareSC(a.id, b.id))
      .map((c) => ({
        id: c.id,
        label: `${c.id} ${scTitle(c.id, lang) ?? ""}`.trim(),
        group: c.guideline,
        status: c.status,
        tests: [],
        decidedBy: c.decidedBy,
        ...(c.inapplicable ? { inapplicable: true } : {}),
      }));
  }
  const pack = loadPack(standard);
  const byId = new Map(derivePackResults(pageView(result, page), standard).map((r) => [r.id, r]));
  return pack.criteria.map((pc) => ({
    id: pc.id,
    label: `${pc.id} — ${titlePlain(pack, pc, lang)}`,
    group: `${pc.theme}. ${themeName(pack, pc.theme, lang) ?? ""}`.trim(),
    status: byId.get(pc.id)?.status ?? "manual",
    tests: packTestIds(pack, pc.id),
    decidedBy: byId.get(pc.id)?.decidedBy,
    ...(byId.get(pc.id)?.inapplicable ? { inapplicable: true } : {}),
  }));
}

/** The pages, PROJECTED ONTO THE ACTIVE STANDARD — criteria, coverage and rate.
 *
 *  `derivePages` is WCAG-keyed, because the core is what the engine decides. Every rendered
 *  surface then re-projects through `pageCriterionRows`, and the JSON output did not: the same
 *  command, with the same `--standard rgaa`, answered `67 % (6/55)` in JSON and `92 % (65/106)`
 *  in its own report. Two documents about one page, disagreeing on both the number and what it
 *  was a number OF.
 *
 *  So the projection lives here, once, and the JSON reads it like everything else. */
export function pagesForStandard(result: AuditResult, pages: PageResult[], standard: StandardId, lang: Lang): PageResult[] {
  if (isCore(standard)) return pages;
  return pages.map((p) => {
    const rows = pageCriterionRows(result, p, standard, lang);
    const cov = pageCoverage(rows);
    return {
      ...p,
      criteria: rows.map((r) => ({
        id: r.id,
        guideline: r.group,
        status: r.status,
        findings: [],
        ...(r.decidedBy ? { decidedBy: r.decidedBy } : {}),
      })),
      conformancePct: pageRatePct(rows),
      decided: cov.decided,
      total: cov.total,
    };
  });
}

export function pageTally(rows: PageCriterionRow[]): { c: number; nc: number; na: number; manual: number } {
  return {
    c: rows.filter((r) => r.status === "C").length,
    nc: rows.filter((r) => r.status === "NC").length,
    // No row carries `NA` any more (INAPPLICABLE_STATUS); this counts the conformities
    // reached for want of a subject, and it is a SUBSET of `c` rather than a fourth bucket.
    na: rows.filter((r) => r.inapplicable).length,
    manual: rows.filter((r) => r.status === "manual").length,
  };
}

/** The tally as one sentence — « X conforme(s) · Y non conforme(s) · … ». Exported for the
 *  same reason `formatRate` is: the sheet, the HTML and the pull-request grid all state a
 *  page's standing, and a surface that phrases its own is a surface that will drift. The
 *  « à évaluer » count is the half readers drop, and it is the one that says how much of the
 *  page nobody has ruled on yet. */
export function pageTallyNote(t: { c: number; nc: number; na: number; manual: number }, lang: Lang): string {
  return L[lang].tally(t.c, t.nc, t.na, t.manual);
}

/** The rate's denominator, extracted so the sheet's « Couverture » line and the index cell are
 *  computed ONCE. They disagreed before: the sheet said 2/106 while the index printed a bare
 *  100 %, and the index is the artefact people paste into a pull request. */
export function pageCoverage(rows: PageCriterionRow[]): { decided: number; total: number } {
  const t = pageTally(rows);
  return { decided: t.c + t.nc, total: rows.length };
}

/** The rate over the criteria of the ACTIVE standard, decided ones only. Under a pack this is
 *  the pack's own arithmetic, not the WCAG one, so the number agrees with the grid above it
 *  rather than with a different denominator.
 *
 *  NULL when nothing was decided — see `pct` in src/pages.ts. Returning 100 there is what let a
 *  page nobody had assessed be quoted as a page with nothing wrong. */
export function pageRatePct(rows: PageCriterionRow[]): number | null {
  const { c, nc } = pageTally(rows);
  return c + nc === 0 ? null : Math.round((c / (c + nc)) * 100);
}

/** One page's dossier: identity, screenshot, rate, the full criteria grid, then every
 *  non-conformity as the shared auditor block. */
export function renderPageReport(result: AuditResult, page: PageResult, opts: PageReportOpts = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const h = opts.heading ?? "##";
  const s = L[lang];
  const out: string[] = [];

  out.push(`${h} ${page.name}${page.auth ? " 🔒" : ""}`, "");

  const meta: string[] = [];
  meta.push(`- **${s.url}** : \`${page.url}\``);
  meta.push(`- **${s.basis}** : ${basisLabel(page.basis, lang)}`);
  if (page.auth) meta.push(`- **${s.auth}** : ✅`);
  out.push(...meta);

  const rows = pageCriterionRows(result, page, standard, lang);
  const t = pageTally(rows);
  const cov = pageCoverage(rows);
  const rate = pageRatePct(rows);
  out.push(`- **${s.rate}** : **${rate === null ? "—" : `${rate} %`}** _(${s.rateNote})_`);
  out.push(`- ${pageTallyNote(t, lang)}`);
  // The rate alone reads as a verdict on the page. Naming the denominator next to it is
  // what stops "100 %" over six decided criteria from being quoted as a conformant page.
  out.push(`- ${s.coverage(cov.decided, cov.total)}`, "");

  // A source-only page cannot earn conformity by silence. Say so ON THE PAGE, not only in a
  // legend the reader may never reach — this is the sentence that stops a clean-looking
  // sheet from being read as a clean page.
  if (page.basis !== "snapshot") out.push(`> ⚠️ ${s.sourceWarn}`, "");

  const shot = opts.screenshots?.get(page.id);
  if (shot) out.push(`![${s.screenshotAlt(page.name)}](${shot})`, "");
  else out.push(`_${s.noScreenshot}_`, "");

  // What the evidence tier refused to draw, and why. An unillustrated occurrence must never
  // read as an absent one — the whole posture of this engine is that nothing is cut silently.
  const refused = opts.evidenceNotice?.(page.id) ?? [];
  if (refused.length) out.push(...refused, "");

  // The grid carries the criterion's own numbered TESTS, not just its title and status:
  // those tests are what has to be checked, and listing them only inside the
  // non-conformity blocks meant a sheet said nothing about the work still to do on the
  // ~99 criteria that never triggered. Test ids go in backticks and are never followed by
  // an em dash — `check`'s criterion scanner matches `(\d+\.\d+)\s*—` and would capture
  // "2.1" out of "6.2.1 — …".
  const withTests = rows.some((r) => r.tests.length);
  out.push(`${h}# ${s.gridTitle}`, "", `> ${s.gridNote}`, "");
  out.push(withTests ? `| ${s.criterion} | ${s.tests} | ${s.status} |` : `| ${s.criterion} | ${s.status} |`);
  out.push(withTests ? "| --- | --- | --- |" : "| --- | --- |");
  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      out.push(withTests ? `| **${group}** | | |` : `| **${group}** | |`);
    }
    const mark = row.decidedBy === "agent" && row.status === "C" ? `${MARK[row.status]}*` : MARK[row.status];
    if (withTests) out.push(`| ${row.label} | ${row.tests.map((t) => `\`${t}\``).join(" ")} | ${mark} |`);
    else out.push(`| ${row.label} | ${mark} |`);
  }
  out.push("", `> ${s.manualWarn}`, "");
  if (rows.some((r) => r.decidedBy === "agent" && r.status === "C")) out.push(`> ${agentMarkNote(lang)}`, "");

  // The non-conformities, rendered by the ONE auditor block (invariant 2). Feeding
  // `prdUnits` the page view is what scopes them to this page without a second grouping.
  const units = prdUnits(pageView(result, page), standard, lang);
  const ncUnits = units.filter((u) => !u.advisory);
  const advUnits = units.filter((u) => u.advisory);

  const unit = { heading: `${h}##`, collapse: true, ...(opts.cropFor ? { cropFor: opts.cropFor } : {}) };
  out.push(`${h}# ${s.ncTitle}`, "");
  if (!ncUnits.length) out.push(s.noNc, "");
  else for (const u of ncUnits) out.push(...renderAuditorUnit(u, standard, lang, unit));

  if (advUnits.length) {
    out.push(`${h}# 💡 ${s.recTitle}`, "", `> ${s.recNote}`, "");
    for (const u of advUnits) out.push(...renderAuditorUnit(u, standard, lang, unit));
  }

  return out.join("\n");
}

function header(result: AuditResult, pages: PageResult[], standard: StandardId, lang: Lang, title: string): string[] {
  const s = L[lang];
  return [
    pagesReportMarker(standard),
    "",
    `# ${title}`,
    "",
    `- **${s.date}** : ${result.date}`,
    `- **${s.standard}** : ${isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name}`,
    `- **${s.pagesCount}** : ${pages.length}`,
    "",
  ];
}

/** The index of a split report: one row per page, then the link to its sheet. */
export function renderPagesIndex(result: AuditResult, pages: PageResult[], opts: PageReportOpts & { hrefs?: Map<string, string> } = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const s = L[lang];
  const out = header(result, pages, standard, lang, s.indexTitle);
  out.push(`> ${s.indexNote}`, "");
  out.push(`| ${s.page} | ${s.url} | ${s.basis} | ${s.rateShort} | ${s.blocking} | ${s.major} | ${s.minor} | ${s.sheet} |`);
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const p of pages) {
    const rows = pageCriterionRows(result, p, standard, lang);
    const cov = pageCoverage(rows);
    // Severity counts must see the SAME findings the rate did. Under a pack the rate comes from
    // `derivePackResults`, which reads packFindings; counting only `p.findings` printed
    // "0 · 0 · 0" beside a rate that had already counted those non-conformities.
    const nc = [...p.findings, ...(result.packFindings ?? []).filter((f) => f.page === p.id)].filter((f) => !f.advisory);
    const href = opts.hrefs?.get(p.id);
    out.push(
      `| ${p.name}${p.auth ? " 🔒" : ""} | \`${p.url}\` | ${basisLabel(p.basis, lang)} | ${formatRate(pageRatePct(rows), cov.decided, cov.total)} | ${
        nc.filter((f) => f.severity === "bloquant").length
      } | ${nc.filter((f) => f.severity === "majeur").length} | ${nc.filter((f) => f.severity === "mineur").length} | ${href ? `[${p.id}](${href})` : p.id} |`,
    );
  }
  out.push("");
  const orphans = unattributedFindings(result);
  if (orphans.length) out.push(`> ${s.unattributed(orphans.length)}`, "");
  return out.join("\n");
}

/** The whole report as ONE document: the same index table, then every page's dossier. */
export function renderPagesDocument(result: AuditResult, pages: PageResult[], opts: PageReportOpts = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const out: string[] = [renderPagesIndex(result, pages, { ...opts, standard, lang })];
  for (const p of pages) out.push(renderPageReport(result, p, { ...opts, standard, lang, heading: "##" }));
  return out.join("\n");
}

/** One page's dossier as a standalone file (its own `#` heading, its own marker header). */
export function renderPageDocument(result: AuditResult, page: PageResult, opts: PageReportOpts = {}): string {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const s = L[lang];
  const out: string[] = [pagesReportMarker(standard), "", `# ${s.docTitle} — ${page.name}`, "", `- **${s.date}** : ${result.date}`, ""];
  out.push(renderPageReport(result, page, { ...opts, standard, lang, heading: "##" }));
  return out.join("\n");
}
