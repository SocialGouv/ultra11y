// AUDIT → `Doc`. The pure half of the HTML tier.
//
// It DECIDES NOTHING. Every status comes from the shared projections — `reportGroups` /
// `packReportGroups` for the conformance grid, `derivePages` + `pageGridModel` for the
// per-page view, `auditorUnitModel` for a non-conformity block. A second derivation here
// would drift from the Markdown report, and the first symptom of drift in an accessibility
// deliverable is a criterion quietly declared conforming.
//
// It also touches no disk. Crops arrive as a lookup (`CropLookup`); whether their bytes end
// up beside the page or inlined as a data: URI is src/html-emit.ts's problem.
import { auditorUnitModel } from "./auditor.js";
import {
  agentMarkNote,
  basisLabel,
  derivePages,
  formatRate,
  pageBasisWarning,
  pagesOf,
  unattributedFindings,
  unattributedNote,
  pageGridModel,
} from "./pages.js";
import { pageCoverage, pageCriterionRows, pageRatePct, pageTally } from "./pages-report.js";
import { partitionUnits, prdUnits, type PrdUnit } from "./prd.js";
import { packReportGroups, reportCoverage, reportGroups, reportTotals, tallyRows } from "./report.js";
import { CORE, type StandardId, isCore, loadPack, standardLabel } from "./standards/index.js";
import { findingsForStandard } from "./standards/derive.js";
import type { Block, Cell, Doc, Run } from "./html.js";
import type { AuditResult, Finding, Lang, PageResult, Status } from "./types.js";

/** Resolves the annotated crop for one occurrence. Same contract as the auditor block's
 *  `cropFor`, and for the same reason: this module never learns how a finding is keyed. */
export type CropLookup = (f: Finding) => { href: string; alt: string } | undefined;

/** What the evidence tier REFUSED to draw, for one page or — with `null` — for the whole
 *  run. Same shape as the crop lookup and for the same reason: this module never learns how
 *  the evidence tier works, only what it decided (src/evidence.ts `evidenceRefusals`). */
export type RefusalLookup = (pageId: string | null) => { headline: string; reasons: string[] } | undefined;

export interface HtmlReportOpts {
  standard?: StandardId;
  lang?: Lang;
  crops?: CropLookup;
  /** An occurrence with no picture must never read as an occurrence with no defect, so the
   *  document states what it did not draw. Without this, the HTML — the deliverable that
   *  actually reaches the client — is the one surface that keeps the omission to itself. */
  refusals?: RefusalLookup;
  /** Sibling documents, for the nav. */
  nav?: Doc["nav"];
}

/** The refusal list as blocks: the sentence, then one item per reason. */
function refusalBlocks(r: { headline: string; reasons: string[] } | undefined): Block[] {
  if (!r) return [];
  return [
    { kind: "note", tone: "warn", runs: [{ text: r.headline }] },
    { kind: "list", items: r.reasons.map((text) => [{ text }]) },
  ];
}

const T = {
  fr: {
    reportTitle: "Rapport de conformité",
    indexTitle: "Rapport d'accessibilité",
    pagesTitle: "Rapport page par page",
    date: "Date",
    files: "fichiers",
    rate: "réussite automatique",
    synthesis: "Synthèse",
    synthCaption: (h: string) => `Nombre de critères par statut, regroupés par ${h}.`,
    byGuideline: "règle WCAG",
    byTheme: "thématique",
    total: "Total",
    conforming: "C",
    nonConforming: "NC",
    notApplicable: "NA",
    toAssess: "À évaluer",
    group: "Groupe",
    coverage: (d: number, t: number) => `Couverture : ${d}/${t} critère(s) décidé(s). Le taux ne porte que sur eux et ne dit rien des ${t - d} autres.`,
    ncTitle: "Non-conformités",
    ncCaption: "Une entrée par critère non conforme.",
    noNc: "Aucune non-conformité relevée par le moteur statique. Les critères « à évaluer » restent à trancher.",
    recTitle: "Recommandations (non normatives)",
    recNote: "Bonnes pratiques sans test normatif en échec : elles ne rendent aucun critère non conforme et n'entrent pas dans le taux.",
    occurrences: "Occurrences",
    occCaption: (id: string) => `Occurrences du critère ${id}.`,
    where: "Emplacement",
    selector: "Sélecteur",
    what: "Constat",
    evidence: "Preuve",
    perPage: "Bilan page par page",
    perPageCaption: "Taux et constats par page, avec la base sur laquelle chaque page a été jugée.",
    page: "Page",
    url: "URL",
    basis: "Base",
    pageRate: "Taux",
    sheet: "Fiche",
    grid: "Grille des critères",
    gridCaption: (n: string) => `Statut de chaque critère pour la page ${n}.`,
    crossGridCaption: "Statut de chaque critère, page par page.",
    criterion: "Critère",
    status: "Statut",
    legend: "`C` conforme · `NC` non conforme · `—` non applicable · `?` à évaluer.",
    tally: (c: number, nc: number, na: number, m: number) => `${c} conforme(s) · ${nc} non conforme(s) · ${na} non applicable(s) · ${m} à évaluer`,
    manualWarn:
      "Un critère « à évaluer » n'est ni conforme ni non conforme : personne ne l'a encore tranché. Les critères de jugement s'adjugent avec `verify --manual`, ceux « à restituer » avec `scan`.",
    documents: "Documents",
    openComposite: "Rapport complet, en un seul fichier (imprimable en PDF)",
    openPages: "Rapport page par page",
    noScreenshot: "Aucune capture d'écran pour cette page.",
    screenshotAlt: (n: string) => `Capture d'écran de la page ${n}`,
  },
  en: {
    reportTitle: "Conformance report",
    indexTitle: "Accessibility report",
    pagesTitle: "Page-by-page report",
    date: "Date",
    files: "files",
    rate: "automatic pass rate",
    synthesis: "Synthesis",
    synthCaption: (h: string) => `Criteria count per status, grouped by ${h}.`,
    byGuideline: "WCAG guideline",
    byTheme: "theme",
    total: "Total",
    conforming: "C",
    nonConforming: "NC",
    notApplicable: "NA",
    toAssess: "To assess",
    group: "Group",
    coverage: (d: number, t: number) => `Coverage: ${d}/${t} criteria decided. The rate covers only those and says nothing about the other ${t - d}.`,
    ncTitle: "Non-conformities",
    ncCaption: "One entry per non-conforming criterion.",
    noNc: "No non-conformity found by the static engine. The criteria left to assess are still open.",
    recTitle: "Recommendations (non-normative)",
    recNote: "Good practices with no failing normative test: they never make a criterion non-conforming and do not enter the rate.",
    occurrences: "Occurrences",
    occCaption: (id: string) => `Occurrences of criterion ${id}.`,
    where: "Location",
    selector: "Selector",
    what: "Finding",
    evidence: "Evidence",
    perPage: "Page-by-page scoreboard",
    perPageCaption: "Rate and findings per page, with the basis each page was judged on.",
    page: "Page",
    url: "URL",
    basis: "Basis",
    pageRate: "Rate",
    sheet: "Sheet",
    grid: "Criteria grid",
    gridCaption: (n: string) => `Each criterion's status for the ${n} page.`,
    crossGridCaption: "Each criterion's status, page by page.",
    criterion: "Criterion",
    status: "Status",
    legend: "`C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess.",
    tally: (c: number, nc: number, na: number, m: number) => `${c} conforming · ${nc} non-conforming · ${na} not applicable · ${m} to assess`,
    manualWarn:
      'A criterion "to assess" is neither conforming nor non-conforming: nobody has ruled on it yet. Judgment criteria are adjudicated with `verify --manual`, rendering ones with `scan`.',
    documents: "Documents",
    openComposite: "Full report, in a single file (printable to PDF)",
    openPages: "Page-by-page report",
    noScreenshot: "No screenshot for this page.",
    screenshotAlt: (n: string) => `Screenshot of the ${n} page`,
  },
} as const;

/** Backtick-delimited spans in a shared sentence, turned into real `<code>` runs. The honesty
 *  sentences (src/pages.ts) are written once for both Markdown and HTML; this is the only
 *  place their inline code markers are interpreted, and it never interprets anything else. */
function ticks(text: string): Run[] {
  return text.split(/`([^`]+)`/).flatMap((part, i) => (part === "" ? [] : i % 2 === 1 ? [{ text: part, mono: true }] : [{ text: part }]));
}

const stdName = (standard: StandardId): string => (isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name);

/** The run's identity line, and the rate WITH its denominator and its agent mark. */
function headline(result: AuditResult, standard: StandardId, lang: Lang): { runs: Run[]; agentRuled: boolean; decided: number; total: number } {
  const t = T[lang];
  const groups = isCore(standard) ? reportGroups(result, lang) : packReportGroups(result, loadPack(standard), lang);
  const { decided, total } = reportCoverage(groups);
  const agentRuled = groups.some((g) => g.rows.some((r) => r.decidedBy === "agent" && r.status === "C"));
  return {
    runs: [
      { text: result.date, mono: true },
      { text: ` · ${result.scope.files} ${t.files} · ` },
      { text: `${formatRate(decided === 0 ? null : result.conformancePct, decided, total)}${agentRuled ? "*" : ""}`, strong: true },
      { text: ` ${t.rate}` },
    ],
    agentRuled,
    decided,
    total,
  };
}

/** §1 — the synthesis grid, then the coverage sentence under it. */
function synthesisBlocks(result: AuditResult, standard: StandardId, lang: Lang): Block[] {
  const t = T[lang];
  const core = isCore(standard);
  const groups = core ? reportGroups(result, lang) : packReportGroups(result, loadPack(standard), lang);
  const tot = reportTotals(groups);
  const { decided, total } = reportCoverage(groups);
  const rows: Cell[][] = groups.map((g) => {
    const x = tallyRows(g.rows);
    return [
      { text: `${g.key} ${g.title}`.trim() },
      { text: String(x.c), align: "end" as const },
      { text: String(x.nc), align: "end" as const },
      { text: String(x.na), align: "end" as const },
      { text: String(x.manual), align: "end" as const },
    ];
  });
  rows.push([
    { text: t.total, strong: true },
    { text: String(tot.c), align: "end" as const, strong: true },
    { text: String(tot.nc), align: "end" as const, strong: true },
    { text: String(tot.na), align: "end" as const, strong: true },
    { text: String(tot.manual), align: "end" as const, strong: true },
  ]);
  return [
    { kind: "heading", level: 2, text: t.synthesis, id: "synthesis" },
    {
      kind: "table",
      caption: t.synthCaption(core ? t.byGuideline : t.byTheme),
      columns: [
        { text: t.group },
        { text: t.conforming, align: "end" },
        { text: t.nonConforming, align: "end" },
        { text: t.notApplicable, align: "end" },
        { text: t.toAssess, align: "end" },
      ],
      rows,
    },
    { kind: "note", tone: "warn", runs: ticks(t.coverage(decided, total)) },
    { kind: "note", tone: "warn", runs: ticks(t.manualWarn) },
  ];
}

/** One non-conformity, from `auditorUnitModel` — the same decisions the Markdown block makes,
 *  presented as a table of occurrences with their crops rather than as a checklist. */
function criterionBlocks(unit: PrdUnit, standard: StandardId, lang: Lang, level: 2 | 3 | 4, crops?: CropLookup): Block[] {
  const t = T[lang];
  const m = auditorUnitModel(unit, standard, lang, { collapse: true });
  const out: Block[] = [{ kind: "heading", level, text: `${m.icon} ${m.label}`, id: `c-${unit.criteriaId}` }];
  out.push({ kind: "note", tone: "info", runs: ticks(m.normativeNote) });
  out.push({ kind: "list", items: m.fields.map((f) => [{ text: `${f.label} : `, strong: true }, ...ticks(f.value)]) });
  out.push({
    kind: "para",
    runs: [{ text: `${t.what} (${m.conformanceTerms.nonConformant}) : `, strong: true }, { text: `${m.occurrences} — ${m.messages.join(" ; ")}` }],
  });
  if (m.fixes.length) out.push({ kind: "para", runs: [{ text: `${m.conformanceTerms.conformant} : `, strong: true }, { text: m.fixes.join(" ; ") }] });

  const hasEvidence = crops ? m.normative.some((f) => crops(f)) : false;
  const columns = [{ text: t.where }, { text: t.selector }, { text: t.what }, ...(hasEvidence ? [{ text: t.evidence }] : [])];
  const rows = m.normative.map((f) => {
    const cells: Cell[] = [{ text: `${f.file}:${f.line}`, mono: true }, { text: f.selectorHint, mono: true }, { text: resolveOccurrence(f, lang) }];
    if (hasEvidence) cells.push({ text: crops?.(f) ? "▣" : "" });
    return cells;
  });
  if (rows.length) out.push({ kind: "table", caption: t.occCaption(unit.criteriaId), columns, rows });

  // The crops themselves, as figures — one per occurrence that has one. A table cell is the
  // wrong container for a 960px image, and `<figure>` gives the caption a home.
  if (crops) {
    for (const f of m.normative) {
      const c = crops(f);
      if (c) out.push({ kind: "figure", src: c.href, alt: c.alt, caption: `${f.file}:${f.line} — ${f.selectorHint}` });
    }
  }
  return out;
}

/** The occurrence message, resolved through the same catalogue the Markdown uses. */
function resolveOccurrence(f: Finding, lang: Lang): string {
  // auditorUnitModel already resolved the unit's distinct messages; a per-occurrence one can
  // interpolate its own values (a measured contrast ratio), so it is resolved here.
  return f.msg
    ? (auditorUnitModel({ criteriaId: f.criteriaId, title: "", label: "", refs: [], severity: f.severity, findings: [f] }, CORE, lang).messages[0] ?? f.message)
    : f.message;
}

/** §2 + §Recommendations — every non-conformity, then the advisory units. */
function findingsBlocks(result: AuditResult, standard: StandardId, lang: Lang, level: 2 | 3, crops?: CropLookup, refusals?: RefusalLookup): Block[] {
  const t = T[lang];
  const { nc, advisory } = partitionUnits(prdUnits(result, standard, lang));
  const out: Block[] = [{ kind: "heading", level: 2, text: t.ncTitle, id: "nc" }];
  // Before the first figure, not after the last: a reader who stops scrolling must already
  // know that the pictures below are a subset of the occurrences listed beside them.
  out.push(...refusalBlocks(refusals?.(null)));
  if (!nc.length) out.push({ kind: "para", runs: [{ text: t.noNc }] });
  for (const u of nc) out.push(...criterionBlocks(u, standard, lang, level === 2 ? 3 : 4, crops));
  if (advisory.length) {
    out.push({ kind: "heading", level: 2, text: t.recTitle, id: "rec" });
    out.push({ kind: "note", tone: "info", runs: ticks(t.recNote) });
    for (const u of advisory) out.push(...criterionBlocks(u, standard, lang, level === 2 ? 3 : 4, crops));
  }
  return out;
}

/** The per-page scoreboard: one row per page, its basis, its rate WITH the denominator. */
export function scoreboardBlocks(result: AuditResult, standard: StandardId, lang: Lang, sheetHref?: (id: string) => string): Block[] {
  const t = T[lang];
  const scope = pagesOf(result);
  if (!scope.length) return [];
  const derived = derivePages(result, scope);
  // Through the standard-aware helpers, exactly like `renderPageRates` in src/report.ts:
  // `PageResult.conformancePct` is the WCAG core projection, so under a pack this cell used to
  // quote a rate out of 55 beside a document counting 106.
  const rows = derived.map((p) => {
    const criteria = pageCriterionRows(result, p, standard, lang);
    const cov = pageCoverage(criteria);
    return [
      { text: `${p.name}${p.auth ? " 🔒" : ""}`, ...(sheetHref ? { href: sheetHref(p.id) } : {}) },
      { text: p.url, mono: true },
      { text: basisLabel(p.basis, lang) },
      { text: formatRate(pageRatePct(criteria), cov.decided, cov.total), align: "end" as const },
    ];
  });
  const out: Block[] = [
    { kind: "heading", level: 2, text: t.perPage, id: "pages" },
    {
      kind: "table",
      caption: t.perPageCaption,
      columns: [{ text: t.page }, { text: t.url }, { text: t.basis }, { text: t.pageRate, align: "end" }],
      rows,
    },
  ];
  const orphans = unattributedFindings(result).filter((f) => !f.advisory).length;
  if (orphans) out.push({ kind: "note", tone: "warn", runs: ticks(unattributedNote(orphans, lang)) });
  // One caveat per basis actually present — a "not audited" page must not be explained by the
  // sentence that asserts it has no snapshot.
  for (const basis of ["attributed", "not-audited"] as const) {
    const note = derived.some((p) => p.basis === basis) ? pageBasisWarning(basis, lang) : undefined;
    if (note) out.push({ kind: "note", tone: "warn", runs: ticks(note) });
  }
  return out;
}

/** The cross-page grid: one row per criterion, one column per page. */
export function crossGridBlocks(result: AuditResult, derived: PageResult[], standard: StandardId, lang: Lang): Block[] {
  const t = T[lang];
  if (!derived.length) return [];
  const { rows, status } = pageGridModel(result, derived, standard, lang);
  if (!rows.length) return [];
  const table: Block = {
    kind: "table",
    caption: t.crossGridCaption,
    columns: [{ text: t.criterion }, ...derived.map((p) => ({ text: `${p.name}${p.auth ? " 🔒" : ""}` }))],
    rows: [],
  };
  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      table.rows.push([{ text: group, colspan: derived.length + 1 }]);
    }
    table.rows.push([{ text: row.label }, ...derived.map((p) => ({ status: (status.get(row.id)?.get(p.id) ?? "manual") as Status, text: "" }))]);
  }
  return [{ kind: "heading", level: 2, text: t.grid, id: "grid" }, { kind: "note", tone: "info", runs: ticks(t.legend) }, table];
}

/** One page's criteria grid — the sheet's own table, not the cross-page one. */
function pageGridBlocks(result: AuditResult, page: PageResult, standard: StandardId, lang: Lang): Block[] {
  const t = T[lang];
  const rows = pageCriterionRows(result, page, standard, lang);
  if (!rows.length) return [];
  const cov = pageCoverage(rows);
  const tally = pageTally(rows);
  const table: Block = { kind: "table", caption: t.gridCaption(page.name), columns: [{ text: t.criterion }, { text: t.status }], rows: [] };
  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      table.rows.push([{ text: group, colspan: 2 }]);
    }
    // A conformity an agent RULED carries the mark here too, exactly as on the Markdown sheet.
    table.rows.push([{ text: row.label }, { status: row.status, text: row.decidedBy === "agent" && row.status === "C" ? "*" : "" }]);
  }
  const out: Block[] = [
    { kind: "heading", level: 2, text: t.grid },
    {
      kind: "para",
      runs: [
        { text: `${t.pageRate} : `, strong: true },
        { text: formatRate(pageRatePct(rows), cov.decided, cov.total), strong: true },
      ],
    },
    { kind: "para", runs: [{ text: t.tally(tally.c, tally.nc, tally.na, tally.manual) }] },
    { kind: "note", tone: "info", runs: ticks(t.legend) },
    table,
  ];
  if (rows.some((r) => r.decidedBy === "agent" && r.status === "C")) out.push({ kind: "note", tone: "warn", runs: ticks(agentMarkNote(lang)) });
  return out;
}

/** THE ENTRY POINT. Dashboard only: identity, rate, synthesis, scoreboard, and the links out.
 *  It carries no image, so an artifact viewer opens it instantly however heavy the evidence. */
export function indexDoc(result: AuditResult, opts: HtmlReportOpts & { links?: { href: string; text: string }[] } = {}): Doc {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const t = T[lang];
  const h = headline(result, standard, lang);
  const blocks: Block[] = [];
  if (opts.links?.length) {
    blocks.push({ kind: "heading", level: 2, text: t.documents, id: "documents" });
    blocks.push({ kind: "list", items: opts.links.map((l) => [{ text: l.text, href: l.href }]) });
  }
  blocks.push(...synthesisBlocks(result, standard, lang));
  if (h.agentRuled) blocks.push({ kind: "note", tone: "warn", runs: ticks(agentMarkNote(lang)) });
  blocks.push(...scoreboardBlocks(result, standard, lang));
  return { lang, title: `${t.indexTitle} — ${stdName(standard)}`, subtitle: h.runs, ...(opts.nav ? { nav: opts.nav } : {}), blocks };
}

/** THE COMPOSITE — one detachable, printable file carrying the whole audit. */
export function compositeDoc(result: AuditResult, opts: HtmlReportOpts = {}): Doc {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const t = T[lang];
  const h = headline(result, standard, lang);
  const blocks: Block[] = [...synthesisBlocks(result, standard, lang)];
  if (h.agentRuled) blocks.push({ kind: "note", tone: "warn", runs: ticks(agentMarkNote(lang)) });
  blocks.push(...findingsBlocks(result, standard, lang, 2, opts.crops, opts.refusals));
  blocks.push(...scoreboardBlocks(result, standard, lang));
  const scope = pagesOf(result);
  if (scope.length) blocks.push(...crossGridBlocks(result, derivePages(result, scope), standard, lang));
  return { lang, title: `${t.reportTitle} ${standardLabel(standard)} — ${result.date}`, subtitle: h.runs, ...(opts.nav ? { nav: opts.nav } : {}), blocks };
}

/** The page site's index. */
export function pagesIndexDoc(
  result: AuditResult,
  opts: HtmlReportOpts & { sheetHref: (id: string) => string } = { sheetHref: (id) => `./page-${id}.html` },
): Doc {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const t = T[lang];
  const h = headline(result, standard, lang);
  const scope = pagesOf(result);
  const blocks: Block[] = [...scoreboardBlocks(result, standard, lang, opts.sheetHref)];
  if (scope.length) blocks.push(...crossGridBlocks(result, derivePages(result, scope), standard, lang));
  return { lang, title: `${t.pagesTitle} — ${stdName(standard)}`, subtitle: h.runs, ...(opts.nav ? { nav: opts.nav } : {}), blocks };
}

/** One page's dossier: identity, screenshot, grid, then its own non-conformities. */
export function pageDoc(result: AuditResult, page: PageResult, opts: HtmlReportOpts & { screenshot?: string } = {}): Doc {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const t = T[lang];
  const blocks: Block[] = [
    {
      kind: "list",
      items: [
        [
          { text: `${t.url} : `, strong: true },
          { text: page.url, mono: true },
        ],
        [{ text: `${t.basis} : `, strong: true }, { text: basisLabel(page.basis, lang) }],
      ],
    },
  ];
  const warn = pageBasisWarning(page.basis, lang);
  if (warn) blocks.push({ kind: "note", tone: "warn", runs: ticks(warn) });
  blocks.push(
    opts.screenshot ? { kind: "figure", src: opts.screenshot, alt: t.screenshotAlt(page.name) } : { kind: "para", runs: [{ text: t.noScreenshot, em: true }] },
  );
  // Right after the capture and before the grid — the same place the Markdown sheet puts it
  // (src/pages-report.ts), so a reader moving between the two documents finds it twice in
  // the same spot rather than once in one of them.
  blocks.push(...refusalBlocks(opts.refusals?.(page.id)));
  blocks.push(...pageGridBlocks(result, page, standard, lang));

  // The page's OWN findings, through the same view the Markdown sheet uses — so a criterion
  // cannot be non-conforming here and conforming there.
  const view: AuditResult = { ...result, criteria: page.criteria, findings: page.findings };
  const { nc, advisory } = partitionUnits(prdUnits(view, standard, lang));
  blocks.push({ kind: "heading", level: 2, text: t.ncTitle });
  if (!nc.length) blocks.push({ kind: "para", runs: [{ text: t.noNc }] });
  for (const u of nc) blocks.push(...criterionBlocks(u, standard, lang, 3, opts.crops));
  if (advisory.length) {
    blocks.push({ kind: "heading", level: 2, text: t.recTitle });
    blocks.push({ kind: "note", tone: "info", runs: ticks(t.recNote) });
    for (const u of advisory) blocks.push(...criterionBlocks(u, standard, lang, 3, opts.crops));
  }
  return {
    lang,
    title: `${page.name} — ${stdName(standard)}`,
    subtitle: [{ text: result.date, mono: true }, { text: ` · ${findingsForStandard(view, standard).length} ${t.what.toLowerCase()}` }],
    ...(opts.nav ? { nav: opts.nav } : {}),
    blocks,
  };
}
