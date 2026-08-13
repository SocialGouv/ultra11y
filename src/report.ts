// `report` — render an AuditResult into a dated compliance report (Markdown). The
// CANONICAL, gated report is WCAG 2.2 Level AA (renderReport). A country standards
// pack (RGAA, …) gets a DERIVED report (renderPackReport) projected from the same
// WCAG-keyed result. Both keep the honest structure: per-guideline/theme synthesis,
// non-conformities, conforming + not-applicable lists, and the manual worklist
// (never silently C).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AuditResult, Finding, Lang, Severity, Status } from "./types.js";
import { guidelineTitle, scTitle } from "./wcag.js";
import { prdUnits, partitionUnits } from "./prd.js";
import { renderAuditorUnit } from "./auditor.js";
import { resolveMessage } from "./messages.js";
import { attributePages, derivePages, pagesOf, renderPageGrid } from "./pages.js";
import { PAGES_DIR } from "./snapshot.js";
import {
  type StandardId,
  CORE,
  isCore,
  loadPack,
  derivePackResults,
  packCriteriaForFinding,
  packConformancePct,
  packTestIds,
  title as packTitle,
  themeName,
  type StandardPack,
} from "./standards/index.js";

const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };
const SEV_ORDER: Severity[] = ["bloquant", "majeur", "mineur"];

/** How many findings the « Constats par page » summary lists for one page before it stops. The
 *  section is a summary — the page's own sheet carries the full list — but a cap that stops
 *  silently is indistinguishable from a page that simply had nothing more, so the stop is
 *  announced. */
const PER_PAGE_MAX = 30;

const L = {
  fr: {
    title: (std: string) => `Rapport d'audit d'accessibilité — ${std}`,
    wcagStd: "WCAG 2.2 niveau AA",
    date: "Date",
    tool: "Outil",
    toolNote: "moteur statique — audit préliminaire, critères de jugement à adjuger par l'agent IA (statique, gaté), rendu via `scan`",
    scope: "Périmètre",
    files: "fichier(s)",
    rate: "Taux de réussite automatique (vérifications statiques)",
    rateNote: "sous-ensemble décidable par la machine : C ÷ (C + NC)",
    warn: "Ce rapport couvre le sous-ensemble de critères vérifiables automatiquement. Les critères « à évaluer » (rendu / jugement) sont adjugés par l'agent IA (`verify --manual`, de façon gatée) ; le rendu passe par `scan` (voir la dernière section).",
    derived: (std: string) =>
      `Vue dérivée du ${std} : projection des critères de succès WCAG audités sur le référentiel. La vérification d'intégrité (\`check\`/\`verify\`) opère sur le rapport WCAG canonique.`,
    synthTitle: (by: string) => `1. Synthèse par ${by}`,
    byGuideline: "règle WCAG",
    byTheme: "thématique",
    th: (head: string) => [head, "C", "NC", "NA", "À évaluer"],
    total: "Total",
    ncTitle: "2. Non-conformités (par priorité)",
    recTitle: "Recommandations (non normatives)",
    recNote:
      "Bonnes pratiques SANS test normatif du référentiel actif — ce ne sont PAS des non-conformités et elles n'entrent pas dans le taux de réussite. Libre à l'équipe de les suivre.",
    sev: { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" } as Record<Severity, string>,
    none: "Aucune non-conformité détectée par le moteur statique.",
    cTitle: "3. Critères conformes (C)",
    cAgentTitle: "Conformes par adjudication de l'agent (jugement, non prouvé par le moteur)",
    cAgentNote:
      "Ces critères ont été tranchés par l'agent IA à partir des évidences citées, non décidés par le moteur déterministe. Ils sont gatés (chaque verdict cite une évidence résolvable) mais restent un jugement : ils ne sont pas comptés dans le taux de réussite automatique ci-dessus.",
    naTitle: "4. Critères non applicables (NA)",
    manualTitle: "5. Critères à adjuger (jugement / rendu) — non décidés par le moteur statique",
    manualWarn:
      "Adjugez-les avec `verify --manual` (l'agent décide depuis la source, de façon gatée) ; les critères de rendu passent par `scan`. Aucun ne doit être marqué « conforme » sans justification enregistrée et gatée.",
    testsToRule: "tests à trancher",
    manualHowTo:
      "Générez la worklist : `verify --manual --in <audit.json> --standard <pack> --out <dir>`. Chaque item y porte l'énoncé complet de ses tests, sa note technique, ses cas particuliers, sa guidance et les termes que le référentiel définit.",
    outOfScope: "Hors périmètre moteur — mappé sur des SC hors WCAG 2.2 AA ; vérification manuelle.",
    scopedOut: "Les non-conformités WCAG relevées concernent des éléments hors du périmètre de ce critère — à évaluer séparément.",
    judgment: "L’énoncé du critère demande davantage que les CS WCAG auxquels il est rattaché — le moteur n’y a pas répondu, à trancher.",
    nothing: "Aucun.",
    dedup: "Dédup",
    canonical: "fichier(s) canonique(s) audité(s)",
    duplicate: "doublon(s) identique(s) ignoré(s)",
    truncated: (l: number, t: number, s: number) =>
      `Périmètre tronqué : ${l}/${t} fichiers audités (priorité d'abord), ${s} ignoré(s). Élargir avec --max-files.`,
    rendered: (n: number, libs: string) =>
      `Verdict source préliminaire : ${n} fichier(s) rendent des composants de bibliothèque (${libs}) dont le HTML produit n'est pas visible en analyse statique. Auditez la sortie de build (\`render\` / \`audit <dist>\`) ou \`scan\` avant de conclure.`,
    sourceTemplate: (n: number, exts: string) =>
      `Verdict source préliminaire : ${n} composant(s) ${exts} audité(s) en SOURCE (template). Les slots, snippets et liaisons dynamiques (:attr, {@render}) sont invisibles en analyse statique — auditez le rendu (\`render\` / \`scan\`) avant de conclure.`,
    captures: (n: number) => `${n} fichier(s) de capture rendus audités à pleine fidélité (DOM réel) — le vrai HTML produit, pas l'appel de composant.`,
    blindSpots: (n: number) =>
      `${n} composant(s) sans capture rendue (angles morts) — audités sur source opaque uniquement ; auditez leur DOM rendu (\`render --setup\`).`,
    // Task 5 — partial-audit advisory (owner decision: scan stays opt-in but strongly advised).
    // The list names ONLY the needs-rendering criteria still untested (real coverage).
    partialAudit: (list: string) =>
      `Audit partiel — les critères « à restituer » (${list}) n'ont pas été testés. Lancez \`ultra11y scan --sample\` (Playwright + axe + sondes) sur l'échantillon, puis fusionnez avec \`scan --merge\`.`,
    // Task 5 — « Constats par page » (Ara-style per-sample-page synthesis).
    perPageTitle: "Constats par page",
    perPageNote: "Constats regroupés par page de l'échantillon audité (rendu dynamique).",
    transverseNote: (list: string) => `Éléments transverses audités sur chaque page : ${list}.`,
    authYes: "🔒 authentification requise",
    authNo: "🌐 public",
    ncCount: "non-conformité(s)",
    perPageMore: (hidden: number, total: number) =>
      `✂️ ${hidden} autre(s) constat(s) sur cette page ne sont pas listés ici (${total} au total) — voir la fiche de page.`,
    advCount: "recommandation(s)",
    screenshotAlt: (n: string) => `Capture d'écran de la page ${n}`,
  },
  en: {
    title: (std: string) => `Accessibility audit report — ${std}`,
    wcagStd: "WCAG 2.2 Level AA",
    date: "Date",
    tool: "Tool",
    toolNote: "static engine — preliminary audit; judgment criteria adjudicated by the AI agent (statically, gated), rendering via `scan`",
    scope: "Scope",
    files: "file(s)",
    rate: "Automatic static-check pass rate",
    rateNote: "machine-decidable subset: C ÷ (C + NC)",
    warn: "This report covers the subset of criteria checkable automatically. The “to assess” criteria (rendering / judgment) are adjudicated by the AI agent (`verify --manual`, gated); rendering goes through `scan` (see the last section).",
    derived: (std: string) =>
      `Derived view of ${std}: the audited WCAG success criteria projected onto this standard. The integrity gates (\`check\`/\`verify\`) operate on the canonical WCAG report.`,
    synthTitle: (by: string) => `1. Synthesis by ${by}`,
    byGuideline: "WCAG guideline",
    byTheme: "theme",
    th: (head: string) => [head, "C", "NC", "NA", "To assess"],
    total: "Total",
    ncTitle: "2. Non-conformities (by priority)",
    recTitle: "Recommendations (non-normative)",
    recNote:
      "Good practices with NO normative test of the active standard — these are NOT non-conformities and do not enter the pass rate. The team may adopt them at will.",
    sev: { bloquant: "Blocking", majeur: "Major", mineur: "Minor" } as Record<Severity, string>,
    none: "No non-conformity detected by the static engine.",
    cTitle: "3. Conforming criteria (C)",
    cAgentTitle: "Conforming by agent adjudication (judgement, not proven by the engine)",
    cAgentNote:
      "These criteria were ruled on by the AI agent from the evidence it cited, not decided by the deterministic engine. They are gated (every verdict cites resolvable evidence) but remain a judgement: they are not counted in the automatic pass rate above.",
    naTitle: "4. Not-applicable criteria (NA)",
    manualTitle: "5. Criteria to adjudicate (judgment / rendering) — not decided by the static engine",
    manualWarn:
      "Adjudicate these with `verify --manual` (the agent decides from source, gated); rendering criteria go to `scan`. None may be marked “conforming” without a recorded, gated justification.",
    testsToRule: "tests to rule on",
    manualHowTo:
      "Generate the worklist: `verify --manual --in <audit.json> --standard <pack> --out <dir>`. Each item carries the full wording of its tests, its technical note, its particular cases, its guidance and the terms the standard defines.",
    outOfScope: "Out of engine scope — mapped to SCs outside WCAG 2.2 AA; manual verification.",
    scopedOut: "The WCAG failures found concern elements outside this criterion's scope — assess separately.",
    judgment: "The criterion asks more than the WCAG SCs it maps to — the engine did not answer it; rule on it.",
    nothing: "None.",
    dedup: "Dedup",
    canonical: "canonical file(s) audited",
    duplicate: "identical duplicate(s) skipped",
    truncated: (l: number, t: number, s: number) => `Scope truncated: ${l}/${t} files audited (highest-priority first), ${s} skipped. Widen with --max-files.`,
    rendered: (n: number, libs: string) =>
      `Preliminary source verdict: ${n} file(s) render component-library components (${libs}) whose produced HTML is invisible to static analysis. Audit the build output (\`render\` / \`audit <dist>\`) or \`scan\` before concluding.`,
    sourceTemplate: (n: number, exts: string) =>
      `Preliminary source verdict: ${n} ${exts} component(s) audited as SOURCE (template). Slots, snippets and dynamic bindings (:attr, {@render}) are invisible to static analysis — audit the rendered output (\`render\` / \`scan\`) before concluding.`,
    captures: (n: number) => `${n} rendered capture file(s) audited at full fidelity (real DOM) — the true produced HTML, not the component call.`,
    blindSpots: (n: number) =>
      `${n} component(s) without a rendered capture (blind spots) — audited from opaque source only; audit their rendered DOM (\`render --setup\`).`,
    // Task 5 — partial-audit advisory (owner decision: scan stays opt-in but strongly advised).
    // The list names ONLY the needs-rendering criteria still untested (real coverage).
    partialAudit: (list: string) =>
      `Partial audit — the needs-rendering criteria (${list}) were not tested. Run \`ultra11y scan --sample\` (Playwright + axe + probes) on the sample, then merge with \`scan --merge\`.`,
    // Task 5 — « Findings per page » (Ara-style per-sample-page synthesis).
    perPageTitle: "Findings per page",
    perPageNote: "Findings grouped by the audited sample page (dynamic rendering).",
    transverseNote: (list: string) => `Transverse elements audited on every page: ${list}.`,
    authYes: "🔒 authentication required",
    authNo: "🌐 public",
    ncCount: "non-conformity(ies)",
    perPageMore: (hidden: number, total: number) => `✂️ ${hidden} further finding(s) on this page are not listed here (${total} in total) — see its page sheet.`,
    advCount: "recommendation(s)",
    screenshotAlt: (n: string) => `Screenshot of the ${n} page`,
  },
} as const;

// The needs-rendering criteria the scan tier decides, with the labels the partial-audit
// banner names them by. Coverage comes from scope.scan.testedScs (stamped by mergeDynamic:
// Docker measures 1.4.10 only; the local runtime adds zoom / spacing / focus / hover, and
// live regions when interactions are on) — so the banner only ever names criteria that
// genuinely lack a dynamic verdict, and drops only when every one of them is covered.
const NEEDS_RENDERING: readonly { sc: string; label: Record<Lang, string> }[] = [
  { sc: "1.4.4", label: { fr: "zoom 200 %", en: "200% zoom" } },
  { sc: "1.4.10", label: { fr: "reflow 320 px", en: "320px reflow" } },
  { sc: "1.4.12", label: { fr: "espacement du texte", en: "text spacing" } },
  { sc: "2.4.7", label: { fr: "visibilité du focus", en: "focus visibility" } },
  { sc: "1.4.13", label: { fr: "contenu au survol", en: "content on hover" } },
  { sc: "4.1.3", label: { fr: "régions live", en: "live regions" } },
];

/** The scan-tier needs-rendering SCs this audit has NO dynamic verdict for. Coverage =
 *  scope.scan.testedScs (the merge-time stamp); back-compat: a dyn-* probe finding proves
 *  its SC was measured even on an audit merged before the stamp existed. Non-empty ⇒ the
 *  partial-audit advisory shows, naming exactly these criteria. */
export function untestedNeedsRendering(r: AuditResult): string[] {
  const tested = new Set(r.scope.scan?.testedScs ?? []);
  for (const f of r.findings) if (f.ruleId.startsWith("dyn-")) tested.add(f.criteriaId);
  return NEEDS_RENDERING.filter((c) => !tested.has(c.sc)).map((c) => c.sc);
}

/** The partial-audit advisory text (no leading `> `) — shared by the report banner and the
 *  CLI warning (src/cli.ts cmdReport) so the two can never drift. Names ONLY the criteria
 *  in `untested` (default: all of them — the no-scan-at-all case). */
export function partialAuditBanner(lang: Lang, untested: string[] = NEEDS_RENDERING.map((c) => c.sc)): string {
  const set = new Set(untested);
  const labels = NEEDS_RENDERING.filter((c) => set.has(c.sc)).map((c) => c.label[lang]);
  return L[lang].partialAudit(labels.join(", "));
}

// A normalized row the renderer is agnostic about: one labelled criterion + its status/findings.
export interface ReportRow {
  id: string;
  label: string; // "1.4.3 — Contrast (Minimum)" or "RGAA 1.1 — …"
  status: Status;
  findings: Finding[];
  justification?: string;
  // Who decided this criterion. Absent/"engine" = the deterministic engine; "agent" = an
  // adjudication (gated, but a judgement call); "scan" = the rendered tier. Rendered so a
  // conformity the engine PROVED is never presented as the same thing as one an agent
  // RULED — see the split in section 3 and the header rate.
  decidedBy?: "engine" | "agent" | "scan";
}

export interface ReportGroup {
  key: string;
  title: string;
  rows: ReportRow[];
}

export interface ReportTally {
  c: number;
  nc: number;
  na: number;
  manual: number;
}

/** The §1 synthesis arithmetic over one group's rows. */
export function tallyRows(rows: ReportRow[]): ReportTally {
  return {
    c: rows.filter((x) => x.status === "C").length,
    nc: rows.filter((x) => x.status === "NC").length,
    na: rows.filter((x) => x.status === "NA").length,
    manual: rows.filter((x) => x.status === "manual").length,
  };
}

/** The §1 « Total » row: the same arithmetic over every group. */
export function reportTotals(groups: ReportGroup[]): ReportTally {
  const tot: ReportTally = { c: 0, nc: 0, na: 0, manual: 0 };
  for (const g of groups) {
    const t = tallyRows(g.rows);
    tot.c += t.c;
    tot.nc += t.nc;
    tot.na += t.na;
    tot.manual += t.manual;
  }
  return tot;
}

/** The denominator the headline rate never carried. `conformancePct` is computed from the
 *  decided set (src/audit.ts) and then thrown away, which is how « 100 % » reached a pull
 *  request over two decided criteria out of a hundred and six. Every surface that prints the
 *  run-wide rate resolves its `(decided/total)` here. */
export function reportCoverage(groups: ReportGroup[]): { decided: number; total: number } {
  const t = reportTotals(groups);
  return { decided: t.c + t.nc, total: t.c + t.nc + t.na + t.manual };
}

// Shared renderer over normalized groups/rows — keeps the WCAG and pack reports identical
// in shape. `groupHead` labels the synthesis column ("WCAG guideline" / "theme"). `standard`
// drives the NC section below (`prdUnits`/`renderAuditorUnit` are standard-aware).
function render(
  r: AuditResult,
  lang: Lang,
  opts: {
    std: string;
    groupHead: string;
    groups: ReportGroup[];
    standard: StandardId;
    derivedOf?: string;
    partialAudit?: string[];
    headerRatePct?: number;
    // Where this report will be WRITTEN. Only used to resolve the per-page screenshots
    // relatively; absent ⇒ paths relative to the CWD, which is what stdout wants.
    outDir?: string;
  },
): string {
  const s = L[lang];
  const out: string[] = [];
  out.push(`# ${s.title(opts.std)}`, "");
  out.push(`- **${s.date}** : ${r.date}`);
  out.push(`- **${s.tool}** : ultra11y v${r.version} (${s.toolNote})`);
  out.push(`- **${s.scope}** : ${r.scope.files} ${s.files} — ${r.scope.inputs.join(", ")}`);
  out.push(`- **${s.rate}** : ${opts.headerRatePct ?? r.conformancePct}% (${s.rateNote})`);
  if (r.scope.dedup) out.push(`- **${s.dedup}** : ${r.scope.dedup.canonicalFiles} ${s.canonical}, ${r.scope.dedup.duplicateFiles} ${s.duplicate}`);
  out.push("", `> ⚠️ ${s.warn}`, "");
  // Partial-audit advisory banner (owner decision) — a pack audit whose scan coverage
  // leaves needs-rendering criteria untested. Names EXACTLY the untested ones (a Docker
  // run — reflow only — keeps the banner for the local-only probes it never ran). Placed
  // in the header, before the derived-view note. Labels only — no criterion-shaped token,
  // so the `check` structural gate accepts it.
  if (opts.partialAudit?.length) out.push(`> 🚨 ${partialAuditBanner(lang, opts.partialAudit)}`, "");
  if (opts.derivedOf) out.push(`> ↪️ ${s.derived(opts.derivedOf)}`, "");
  if (r.scope.truncated) out.push(`> ✂️ ${s.truncated(r.scope.truncated.limit, r.scope.truncated.total, r.scope.truncated.skipped)}`, "");
  if (r.scope.rendered) out.push(`> 🧩 ${s.rendered(r.scope.rendered.files, r.scope.rendered.opaqueLibraries.join(", "))}`, "");
  if (r.scope.sourceTemplate) out.push(`> 🧩 ${s.sourceTemplate(r.scope.sourceTemplate.files, r.scope.sourceTemplate.extensions.join(", "))}`, "");
  if (r.scope.captures) out.push(`> ✅ ${s.captures(r.scope.captures.files)}`, "");
  if (r.scope.captureCoverage?.blindSpots.length) out.push(`> ⚠️ ${s.blindSpots(r.scope.captureCoverage.blindSpots.length)}`, "");

  const rows = opts.groups.flatMap((g) => g.rows);

  // 1. synthesis
  const th = s.th(opts.groupHead);
  out.push(`## ${s.synthTitle(opts.groupHead)}`, "");
  out.push(`| ${th.join(" | ")} |`);
  out.push(`|${"---|".repeat(th.length)}`);
  for (const g of opts.groups) {
    const t = tallyRows(g.rows);
    out.push(`| ${g.key} ${g.title} | ${t.c} | ${t.nc} | ${t.na} | ${t.manual} |`);
  }
  const tot = reportTotals(opts.groups);
  out.push(`| **${s.total}** | **${tot.c}** | **${tot.nc}** | **${tot.na}** | **${tot.manual}** |`, "");

  // 2. non-conformities by priority — one auditor block per NC criterion (core or
  // pack), the SAME human language `prd`/GitHub issues use (src/auditor.ts
  // `renderAuditorUnit`), grouped by severity like `renderAuditorBacklog`. Reuses
  // `prdUnits` so a criterion here is EXACTLY a `prd`/`gh` backlog item — no
  // report-local re-grouping logic, and the two stay impossible to drift apart.
  out.push(`## ${s.ncTitle}`, "");
  const { nc: ncUnits, advisory: advisoryUnits } = partitionUnits(prdUnits(r, opts.standard, lang));
  if (ncUnits.length === 0) {
    out.push(s.none, "");
  } else {
    for (const sev of SEV_ORDER) {
      const group = ncUnits.filter((u) => u.severity === sev);
      if (!group.length) continue;
      out.push(`### ${ICON[sev]} ${s.sev[sev]} (${group.length})`, "");
      for (const u of group) out.push(...renderAuditorUnit(u, opts.standard, lang, { heading: "####" }));
    }
  }

  // Recommendations (non-normative) — advisory units, AFTER the non-conformities and
  // BEFORE the numbered §3. An UNNUMBERED heading so the 1–5 section numbering `check`
  // requires stays intact, and so the advisory blocks sit outside §2 (packReportNcIds /
  // the NC over-under-projection gate never see them). Only emitted when present.
  if (advisoryUnits.length) {
    out.push(`## 💡 ${s.recTitle}`, "", `> ${s.recNote}`, "");
    for (const u of advisoryUnits) out.push(...renderAuditorUnit(u, opts.standard, lang, { heading: "###" }));
  }

  // « Grille par page » — the per-page criterion matrix. RGAA is a per-page norm, so this is
  // the section an auditor actually reads. UNNUMBERED heading, like the per-page findings
  // below, so `check`'s §1–5 numbering gate and the packReportNcIds parser are untouched.
  const pageScope = pagesOf(r);
  // Attribute the findings to their pages FIRST. Both page sections join on `Finding.page`,
  // and a finding merged from a dynamic scan carries only the scanned URL in `file` until
  // `attributePages` resolves it. `audit` and `scan` already do this when they write the
  // JSON, but a report rendered from an audit produced any other way (a sample-only merge,
  // a hand-assembled result) would otherwise show every page as empty — which reads as
  // "clean", the one thing this tool must never say by accident. The call is an idempotent
  // enrichment: it only fills `page` where something establishes it, and never overwrites.
  if (pageScope.length) attributePages(r, pageScope);
  if (pageScope.length) out.push(renderPageGrid(r, pageScope, opts.standard, lang));

  // « Constats par page » — per-page synthesis (name + URL + auth badge + NC/advisory
  // counts, then the page's findings). UNNUMBERED heading so the 1–5 section numbering
  // `check` requires stays intact and the packReportNcIds parser (section 2) never sees it.
  //
  // It keys on `pageScope`, not on `scope.sample`. A sample was once the only way a page
  // reached the report, but a SNAPSHOT is now the better one (its findings were raised on
  // the page's real DOM, and it is the only basis that can earn conformity). Keying on the
  // sample alone meant every snapshotted page — the E2E fixtures, the dev side-car, and now
  // `scan` itself — was missing from the section named after it.
  if (pageScope.length) {
    const derived = derivePages(r, pageScope);
    out.push(`## 📄 ${s.perPageTitle}`, "", `> ${s.perPageNote}`, "");
    if (r.scope.sample?.transverse?.length) out.push(`> ${s.transverseNote(r.scope.sample.transverse.join(", "))}`, "");
    // Standard-aware per-finding label: a pack report (RGAA, …) speaks its own criteria
    // everywhere else, so this per-page line should too, rather than the raw WCAG SC id.
    // `loadPack` once, outside the finding loop — never per-finding.
    const pack = isCore(opts.standard) ? undefined : loadPack(opts.standard);
    for (const pg of derived) {
      const nc = pg.findings.filter((f) => !f.advisory);
      const adv = pg.findings.filter((f) => f.advisory);
      out.push(`### ${pg.name} — \`${pg.url}\` — ${pg.auth ? s.authYes : s.authNo}`, "");
      out.push(`- ${nc.length} ${s.ncCount}${adv.length ? ` · ${adv.length} ${s.advCount}` : ""}`);
      const notes = pageScope.find((x) => x.id === pg.id)?.notes;
      if (notes) out.push(`- _${notes}_`);
      // The screenshot the snapshot already holds. Copied next to the report when there is
      // an output directory, so the directory travels intact — CI uploads `audits/` alone,
      // and a `../.ultra11y/…` reference is a broken image in the artifact the reviewer
      // opens. Without an --out (stdout), stay relative: there is nothing to be
      // self-contained about.
      const shot = join(PAGES_DIR, pg.id, "screen.png");
      if (existsSync(shot)) {
        let href = relative(opts.outDir ?? ".", shot)
          .split("\\")
          .join("/");
        if (opts.outDir) {
          try {
            mkdirSync(join(opts.outDir, "assets"), { recursive: true });
            copyFileSync(shot, join(opts.outDir, "assets", `${pg.id}.png`));
            href = `./assets/${pg.id}.png`;
          } catch {
            // Unwritable output dir: keep the relative reference rather than lose the image.
          }
        }
        out.push("", `![${s.screenshotAlt(pg.name)}](${href})`);
      }
      // Kept as it was — the point of this change is to DECLARE the cap, not to raise it.
      for (const f of nc.slice(0, PER_PAGE_MAX)) {
        const crits = pack ? packCriteriaForFinding(pack, f) : [];
        const label = crits.length ? crits.join(", ") : f.criteriaId; // graceful fallback to the WCAG SC
        out.push(`  - [${label}] \`${f.selectorHint}\` — ${resolveMessage(f, lang)}`);
      }
      // A cap that says nothing reads as a complete list. Say what was left out, in the same
      // house style as the other scope caveats above — the count is right there in the heading,
      // so a reader who stops at the thirtieth bullet must be told there is a thirty-first.
      if (nc.length > PER_PAGE_MAX) out.push(`  - _${s.perPageMore(nc.length - PER_PAGE_MAX, nc.length)}_`);
      out.push("");
    }
  }

  // 3. conforming — split by PROVENANCE. A criterion the deterministic engine decided and
  // one an agent ruled on are both "C", but they are not the same claim, and merging them
  // into one list (and one headline rate) is how an adjudication pass could publish dozens
  // of conformities nobody had verified. The gate makes an agent C evidence-bound; this
  // keeps it legible as an agent's judgement all the way to the reader.
  out.push(`## ${s.cTitle}`, "");
  const conform = rows.filter((x) => x.status === "C");
  const byEngine = conform.filter((x) => x.decidedBy !== "agent");
  const byAgent = conform.filter((x) => x.decidedBy === "agent");
  if (!conform.length) out.push(s.nothing, "");
  else {
    if (byEngine.length) out.push(...byEngine.map((x) => `- ${x.label}`), "");
    if (byAgent.length) {
      out.push(`### ${s.cAgentTitle}`, "", `> ${s.cAgentNote}`, "");
      out.push(...byAgent.map((x) => `- ${x.label}${x.justification ? ` — _${x.justification}_` : ""}`), "");
    }
  }

  // 4. not applicable
  out.push(`## ${s.naTitle}`, "");
  const na = rows.filter((x) => x.status === "NA");
  out.push(na.length ? na.map((x) => `- ${x.label}${x.justification ? ` — _${x.justification}_` : ""}`).join("\n") : s.nothing, "");

  // 5. manual worklist. Under a country standard this is where nearly the whole audit lives
  // (99 of RGAA's 106 criteria can only ever derive `manual`), so a bare label per line hid
  // the actual work. Name the criterion's own numbered tests: that is what has to be ruled
  // on, and what `verify --manual` hands the agent.
  out.push(`## ${s.manualTitle}`, "", `> ${s.manualWarn}`, "");
  const manual = rows.filter((x) => x.status === "manual");
  if (!manual.length) out.push(s.nothing, "");
  else {
    const pack5 = isCore(opts.standard) ? undefined : loadPack(opts.standard);
    for (const x of manual) {
      const tests = pack5 ? packTestIds(pack5, x.id) : [];
      const testRef = tests.length ? ` — ${s.testsToRule}: ${tests.map((t) => `\`${t}\``).join(" · ")}` : "";
      out.push(`- ${x.label}${x.justification ? ` — _${x.justification}_` : ""}${testRef}`);
    }
    out.push("", `> ${s.manualHowTo}`, "");
  }

  return out.join("\n");
}

/** The canonical, gated WCAG 2.2 AA report. */
/** The CORE report's criterion rows, grouped by WCAG guideline. Extracted from `renderReport`
 *  so the HTML renderer and the CI digest project the SAME decisions the Markdown report
 *  projects — they consume the model, never a second derivation of it. */
export function reportGroups(r: AuditResult, lang: Lang = "en"): ReportGroup[] {
  const byGuideline = new Map<string, ReportRow[]>();
  for (const c of r.criteria) {
    const title = scTitle(c.id, lang);
    const row: ReportRow = {
      id: c.id,
      label: title ? `${c.id} — ${title}` : c.id,
      status: c.status,
      findings: c.findings,
      justification: c.justification,
      decidedBy: c.decidedBy,
    };
    (byGuideline.get(c.guideline) ?? byGuideline.set(c.guideline, []).get(c.guideline)!).push(row);
  }
  // `g.title` on the AuditResult's GuidelineTally is the baked-in English title (kept for
  // JSON back-compat); resolve the localized label from the guideline KEY instead so
  // `--lang fr` renders the French guideline name here too.
  return r.guidelines.map((g) => ({ key: g.key, title: guidelineTitle(g.key, lang) ?? g.title, rows: byGuideline.get(g.key) ?? [] }));
}

export function renderReport(r: AuditResult, lang: Lang = "en", outDir?: string): string {
  const s = L[lang];
  return render(r, lang, { std: s.wcagStd, groupHead: s.byGuideline, groups: reportGroups(r, lang), standard: CORE, outDir });
}

/** A PACK report's criterion rows, grouped by theme. The pack twin of `reportGroups`, and
 *  extracted for the same reason: one projection of a status, consumed by every surface. */
export function packReportGroups(r: AuditResult, pack: StandardPack, lang: Lang = "en"): ReportGroup[] {
  const derived = derivePackResults(r, pack.key);
  const s = L[lang];
  const naReason =
    lang === "fr" ? "Aucun critère de succès WCAG mappé n'est applicable dans le périmètre." : "No mapped WCAG success criterion is applicable in scope.";
  const byTheme = new Map<number, ReportRow[]>();
  for (const pr of derived) {
    const pc = pack.criteria.find((c) => c.id === pr.id)!;
    const row: ReportRow = {
      id: pr.id,
      label: `${pack.name} ${pr.id} — ${packTitle(pack, pc, lang)}`,
      status: pr.status,
      findings: pr.findings,
      ...(pr.decidedBy ? { decidedBy: pr.decidedBy } : {}),
      // outOfScope / scopedOut criteria are "manual" (not NA) with their own dedicated
      // justification — never mixed with the ordinary NA reason (see the manual section above).
      ...(pr.outOfScope
        ? { justification: s.outOfScope }
        : pr.scopedOut
          ? { justification: s.scopedOut }
          : pr.judgment
            ? { justification: s.judgment }
            : pr.status === "NA"
              ? { justification: naReason }
              : {}),
    };
    (byTheme.get(pr.theme) ?? byTheme.set(pr.theme, []).get(pr.theme)!).push(row);
  }
  return pack.themes.map((t) => ({ key: `${t.number}.`, title: themeName(pack, t.number, lang) ?? "", rows: byTheme.get(t.number) ?? [] }));
}

/** A derived report for a country standards pack (RGAA, …), projected from the WCAG audit. */
export function renderPackReport(r: AuditResult, pack: StandardPack, lang: Lang = "en", outDir?: string): string {
  const derived = derivePackResults(r, pack.key);
  const std = `${pack.name} ${pack.baseVersion}`;
  // Owner decision: a pack (RGAA) report is flagged PARTIAL while any needs-rendering
  // criterion lacks a dynamic verdict — the banner names exactly which ones (a Docker-only
  // scan covers reflow but not the local probes). The core WCAG report carries its own §5
  // manual worklist and is not flagged here.
  return render(r, lang, {
    std,
    groupHead: L[lang].byTheme,
    groups: packReportGroups(r, pack, lang),
    derivedOf: std,
    standard: pack.key,
    partialAudit: untestedNeedsRendering(r),
    headerRatePct: packConformancePct(derived),
    // Forwarded, unlike before: without it the per-page screenshots resolved against the
    // CWD instead of the report's own directory, so a pack report written to `audits/`
    // carried links that only worked when read from the repo root.
    outDir,
  });
}

export interface ReportOpts {
  out: string;
  lang: Lang;
  standard: StandardId;
}

/** Render and write the report; returns the written path. The WCAG report is canonical
 *  (`wcag-<date>.md`); a pack report is a derived `<pack>-<date>.md`. */
export function writeReport(r: AuditResult, opts: ReportOpts): string {
  const core = isCore(opts.standard);
  const md = core ? renderReport(r, opts.lang, opts.out) : renderPackReport(r, loadPack(opts.standard), opts.lang, opts.out);
  mkdirSync(opts.out, { recursive: true });
  const path = join(opts.out, `${core ? "wcag" : opts.standard}-${r.date}.md`);
  writeFileSync(path, md);
  return path;
}
