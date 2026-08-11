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
// referenced, never copied: `.ultra11y/pages/<id>/screen.png` is already on disk, so the
// caller resolves a relative path and passes it in — this module stays pure and testable.
import { prdUnits } from "./prd.js";
import { renderAuditorUnit } from "./auditor.js";
import { pageView } from "./pages.js";
import { CORE, type StandardId, derivePackResults, isCore, loadPack, themeName, titlePlain } from "./standards/index.js";
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
    rate: "Taux de conformité",
    rateNote: "sous-ensemble décidable : C ÷ (C + NC)",
    tally: (c: number, nc: number, na: number, m: number) => `${c} conforme(s) · ${nc} non conforme(s) · ${na} non applicable(s) · ${m} à évaluer`,
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
    indexNote: "Une fiche par page. Le taux ne porte que sur les critères décidés — il ne dit rien des critères restant à évaluer.",
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
    rate: "Conformance rate",
    rateNote: "decidable subset: C ÷ (C + NC)",
    tally: (c: number, nc: number, na: number, m: number) => `${c} conforming · ${nc} non-conforming · ${na} not applicable · ${m} to assess`,
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
    indexNote: "One sheet per page. The rate covers only the decided criteria — it says nothing about those left to assess.",
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
}

interface Row {
  id: string;
  label: string;
  group: string;
  status: Status;
}

/** The criterion rows for ONE page, in the active standard's own vocabulary and order.
 *  Delegates every status to the shared projection — see invariant 1 at the top. */
function rowsFor(result: AuditResult, page: PageResult, standard: StandardId, lang: Lang): Row[] {
  if (isCore(standard)) {
    return [...page.criteria]
      .sort((a, b) => compareSC(a.id, b.id))
      .map((c) => ({ id: c.id, label: `${c.id} ${scTitle(c.id, lang) ?? ""}`.trim(), group: c.guideline, status: c.status }));
  }
  const pack = loadPack(standard);
  const byId = new Map(derivePackResults(pageView(result, page), standard).map((r) => [r.id, r.status]));
  return pack.criteria.map((pc) => ({
    id: pc.id,
    label: `${pc.id} — ${titlePlain(pack, pc, lang)}`,
    group: `${pc.theme}. ${themeName(pack, pc.theme, lang) ?? ""}`.trim(),
    status: byId.get(pc.id) ?? "manual",
  }));
}

function tally(rows: Row[]): { c: number; nc: number; na: number; manual: number } {
  return {
    c: rows.filter((r) => r.status === "C").length,
    nc: rows.filter((r) => r.status === "NC").length,
    na: rows.filter((r) => r.status === "NA").length,
    manual: rows.filter((r) => r.status === "manual").length,
  };
}

/** The rate over the criteria of the ACTIVE standard, decided ones only — same basis and
 *  same divide-by-zero convention as the core (`nothing decided ⇒ 100`). Under a pack this
 *  is the pack's own arithmetic, not the WCAG one, so the number agrees with the grid above
 *  it rather than with a different denominator. */
function ratePct(rows: Row[]): number {
  const { c, nc } = tally(rows);
  return c + nc === 0 ? 100 : Math.round((c / (c + nc)) * 100);
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
  meta.push(`- **${s.basis}** : ${page.basis === "snapshot" ? s.snapshot : s.source}`);
  if (page.auth) meta.push(`- **${s.auth}** : ✅`);
  out.push(...meta);

  const rows = rowsFor(result, page, standard, lang);
  const t = tally(rows);
  out.push(`- **${s.rate}** : **${ratePct(rows)} %** _(${s.rateNote})_`);
  out.push(`- ${s.tally(t.c, t.nc, t.na, t.manual)}`, "");

  // A source-only page cannot earn conformity by silence. Say so ON THE PAGE, not only in a
  // legend the reader may never reach — this is the sentence that stops a clean-looking
  // sheet from being read as a clean page.
  if (page.basis !== "snapshot") out.push(`> ⚠️ ${s.sourceWarn}`, "");

  const shot = opts.screenshots?.get(page.id);
  if (shot) out.push(`![${s.screenshotAlt(page.name)}](${shot})`, "");
  else out.push(`_${s.noScreenshot}_`, "");

  out.push(`${h}# ${s.gridTitle}`, "", `> ${s.gridNote}`, "");
  out.push(`| ${s.criterion} | ${s.status} |`, "| --- | --- |");
  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      out.push(`| **${group}** | |`);
    }
    out.push(`| ${row.label} | ${MARK[row.status]} |`);
  }
  out.push("", `> ${s.manualWarn}`, "");

  // The non-conformities, rendered by the ONE auditor block (invariant 2). Feeding
  // `prdUnits` the page view is what scopes them to this page without a second grouping.
  const units = prdUnits(pageView(result, page), standard, lang);
  const ncUnits = units.filter((u) => !u.advisory);
  const advUnits = units.filter((u) => u.advisory);

  out.push(`${h}# ${s.ncTitle}`, "");
  if (!ncUnits.length) out.push(s.noNc, "");
  else for (const u of ncUnits) out.push(...renderAuditorUnit(u, standard, lang, { heading: `${h}##` }));

  if (advUnits.length) {
    out.push(`${h}# 💡 ${s.recTitle}`, "", `> ${s.recNote}`, "");
    for (const u of advUnits) out.push(...renderAuditorUnit(u, standard, lang, { heading: `${h}##` }));
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
  out.push(`| ${s.page} | ${s.url} | ${s.basis} | ${s.rate} | ${s.blocking} | ${s.major} | ${s.minor} | ${s.sheet} |`);
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const p of pages) {
    const rows = rowsFor(result, p, standard, lang);
    const nc = p.findings.filter((f) => !f.advisory);
    const href = opts.hrefs?.get(p.id);
    out.push(
      `| ${p.name}${p.auth ? " 🔒" : ""} | \`${p.url}\` | ${p.basis === "snapshot" ? s.snapshot : s.source} | ${ratePct(rows)} % | ${
        nc.filter((f) => f.severity === "bloquant").length
      } | ${nc.filter((f) => f.severity === "majeur").length} | ${nc.filter((f) => f.severity === "mineur").length} | ${href ? `[${p.id}](${href})` : p.id} |`,
    );
  }
  out.push("");
  const orphans = result.findings.filter((f) => !f.page);
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
