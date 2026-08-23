// THE PAGE DIMENSION. RGAA — like every country standard — is a per-page norm: an audit runs
// over a declared sample of pages and each criterion gets a status ON EACH PAGE. The engine's
// verdict, though, is scope-wide: one status per criterion for the whole run. This module
// derives the missing dimension from what the audit already knows, without measuring anything
// a second time.
//
// Three honesty rules govern the whole file, and they are the reason it is not simply
// "group findings by page":
//
//   1. A finding is attributed to a page only when something SAYS so — the snapshot it was
//      raised on, the page URL it was scanned from, the sample page name it carries, or the
//      page's own recorded source files. Anything else stays UNATTRIBUTED and is reported as
//      such. Spreading an unlocatable finding across every page would invent non-conformities.
//
//   2. "No finding on this page" only means CONFORMING when this page's real rendered DOM was
//      audited (basis "snapshot"). For a page assembled purely by source attribution, absence
//      of evidence is not evidence of absence, and the criterion stays `manual`. That is the
//      same posture the engine takes everywhere else: never silently conforming.
//
//   3. Silence only decides what the engine CAN decide. A scope-wide `NC` on a judgment
//      criterion means one definite failure fired somewhere — not that the engine can rule
//      on that criterion. Reading it as `C` on every other page is how a page with no images
//      scored 100% on "does each image have a relevant alternative?". See `pageStatus`.
import { snapshotPageId } from "./snapshot.js";
import { CORE, type StandardId, derivePackResults, isCore, loadPack, themeName } from "./standards/index.js";
import type { AuditResult, CriterionResult, Finding, Lang, PageCoverage, PageResult, PageScope, Status, ScanRedirect } from "./types.js";
import { renderedProvesOn } from "./coverage.js";
import { renderedRulesFor } from "./rules/rendered.js";
import { isUrlPath } from "./util.js";
import { automatability, compareSC, scTitle } from "./wcag.js";

/** The page scope recorded on an AuditResult, from the snapshots that were ingested. A
 *  snapshot's presence IS what earns the page its "snapshot" basis. */
export function pageScopesFrom(
  snapshots: { meta: { id: string; name: string; url: string; auth?: boolean; route?: string; sources?: string[]; notes?: string } }[],
): PageScope[] {
  return snapshots.map((s) => ({
    id: s.meta.id,
    name: s.meta.name,
    url: s.meta.url,
    ...(s.meta.auth !== undefined ? { auth: s.meta.auth } : {}),
    ...(s.meta.route ? { route: s.meta.route } : {}),
    ...(s.meta.sources ? { sources: s.meta.sources } : {}),
    ...(s.meta.notes ? { notes: s.meta.notes } : {}),
    basis: "snapshot" as const,
  }));
}

/** The page scope a `scan --sample` run recorded. Those pages were SCANNED, not snapshotted:
 *  their findings are real, but the static rules never ran against a serialized DOM, so they
 *  cannot earn a conforming verdict by silence — basis "attributed". */
export function pageScopesFromSample(sample: { pages: { id: string; name: string; url: string; auth?: boolean; notes?: string }[] } | undefined): PageScope[] {
  return (sample?.pages ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    ...(p.auth !== undefined ? { auth: p.auth } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    basis: "attributed" as const,
  }));
}

/** Every page in scope for an AuditResult: the snapshots it recorded, plus any sample pages a
 *  merged dynamic scan added that no snapshot already covers.
 *
 *  THE SINGLE FUNNEL, and therefore where a claimed basis is checked against the evidence.
 *  `pageScopesFrom` grants `basis: "snapshot"` to every directory it finds under
 *  `.ultra11y/pages`, which says only that a snapshot EXISTS — not that this run read it. A
 *  source-only `audit` records all of them and audits none, and `pageStatus` then reads silence
 *  on a "snapshot" page as conformity. That is the second half of the 100 % artefact, and it
 *  survives any amount of attribution fixing. A page the audit did not read is downgraded here.
 *
 *  Only when `scope.pagesAudited` is present: an audit written before it existed reports
 *  `undefined`, meaning "unknown", and keeps its recorded basis rather than being retroactively
 *  accused. Present-and-empty is a real claim; absent is not. */
export function pagesOf(result: AuditResult): PageScope[] {
  const fromScope = result.scope.pages ?? [];
  const audited = result.scope.pagesAudited;
  const checked =
    audited === undefined ? fromScope : fromScope.map((p) => (p.basis === "snapshot" && !audited.includes(p.id) ? { ...p, basis: "not-audited" as const } : p));
  const ids = new Set(checked.map((p) => p.id));
  const urls = new Set(checked.map((p) => p.url));
  const extra = pageScopesFromSample(result.scope.sample).filter((p) => !ids.has(p.id) && !urls.has(p.url));
  // WHAT EACH PAGE WAS MEASURED BY, stamped here and nowhere else. The coverage is persisted as
  // one map on the scope (so the JSON does not repeat a rule list per page) and every consumer
  // reads it through the page it belongs to — the same single funnel that already downgrades a
  // basis nothing backs. A page with no record keeps `coverage` undefined, which concludes
  // nothing (see PageCoverage).
  const cov = result.scope.pageCoverage;
  const stamped = cov ? [...checked, ...extra].map((p) => (cov[p.id] ? { ...p, coverage: cov[p.id] } : p)) : [...checked, ...extra];
  // A page this audit did not read has no measurement to its name, whatever a stale coverage
  // map says: the basis guard above and this one answer the same question and must not
  // disagree — otherwise a source-only re-run would re-publish the verdicts of a sweep it
  // never performed.
  return stamped.map((p) => (p.basis === "snapshot" ? p : p.coverage ? { ...p, coverage: undefined } : p));
}

/** Capture provenance is repo-relative ("app/page.tsx"); a finding's file may be cwd-relative
 *  or absolute. Match on a path suffix so either side resolves the other — same rule as
 *  src/capture.ts pathMatch. */
function pathMatch(a: string, b: string): boolean {
  const x = a.split("\\").join("/");
  const y = b.split("\\").join("/");
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** Stamp `page` on every finding whose page can be established. Mutates in place, mirroring
 *  `enrichCaptureOrigins`. Findings already stamped (raised on a snapshot) are left alone. */
export function attributePages(result: AuditResult, pages: PageScope[]): void {
  if (!pages.length) return;
  const byName = new Map(pages.map((p) => [p.name.toLowerCase(), p.id]));
  const byUrl = new Map(pages.map((p) => [p.url, p.id]));
  const byId = new Set(pages.map((p) => p.id));

  // Declarative PACK-RULE findings are attributed exactly like core ones. They used to be
  // skipped here, which made `pageView`'s `packFindings.filter(f => f.page === page.id)`
  // always empty: a pack rule could be NC in the report and reach no cell of the grid, while
  // the grid claimed to agree with the report "by construction".
  for (const f of [...result.findings, ...(result.packFindings ?? [])]) {
    if (f.page) continue; // the snapshot it was raised on already said which page it is

    // THE PATH IS PROVENANCE, and it is the only provenance an already-written audit still has.
    // A finding raised on `.ultra11y/pages/<id>/dom.html` knows its page from the file it cites,
    // with no capture comment to consult and no dom.html needing to still exist on disk — which
    // is what lets `pages` repair an audit.json produced before the stamp worked, or by a
    // producer that never wrote the comment. Without it those findings are unrecoverable and
    // every page earns `C` by silence: 700 findings, 0 attributed, every sheet at 100%.
    //
    // The `continue` is load-bearing: a snapshot path must never fall through to the `sources`
    // suffix matcher below, where `.ultra11y/pages/x/dom.html` could suffix-match a sloppy
    // sources entry and land on the wrong page. And an id no page in scope claims stays
    // unattributed rather than conjuring a page — honesty rule 1.
    const snapId = snapshotPageId(f.file) ?? snapshotPageId(f.origin?.capture);
    if (snapId) {
      if (byId.has(snapId)) f.page = snapId;
      continue;
    }

    // A merged dynamic finding keeps the scanned page URL as its `file`.
    if (isUrlPath(f.file)) {
      const hit = byUrl.get(f.file);
      if (hit) f.page = hit;
      continue; // a URL we do not know is honestly unattributed
    }

    // `scan --sample` carries the human page NAME.
    const sampleName = f.sample?.page?.toLowerCase();
    if (sampleName && byName.has(sampleName)) {
      f.page = byName.get(sampleName);
      continue;
    }

    // A SOURCE finding: attribute it via the page's recorded source files. The source that
    // rendered the page is the honest link between "this code" and "this page". First match
    // wins so the result is deterministic — a shared component legitimately belongs to
    // several pages, and duplicating the finding would inflate every page's count.
    const src = f.origin?.sourceFile ?? f.file;
    for (const p of pages) {
      if (p.sources?.some((s) => pathMatch(src, s))) {
        f.page = p.id;
        break;
      }
    }
  }
}

/** Findings no page could claim. Reported explicitly — never silently dropped, never spread. */
export function unattributedFindings(result: AuditResult): Finding[] {
  // Pack findings included: `attributePages` deliberately stamps them (see its loop), and
  // `pageView` filters them per page, so a pack orphan is dropped from every page AND from the
  // count that exists to say so — counted nowhere, on every RGAA audit.
  return [...result.findings, ...(result.packFindings ?? [])].filter((f) => !f.page);
}

/** The status a criterion holds ON one page. See the two honesty rules at the top, and the
 *  third one enforced here. */
function pageStatus(c: CriterionResult, pageFindings: Finding[], basis: PageScope["basis"], coverage?: PageCoverage): Status {
  // A non-normative recommendation can never flip a criterion to NC — same rule as core.
  if (pageFindings.some((f) => !f.advisory)) return "NC";
  // A MEASUREMENT ON THIS PAGE IS NOT SILENCE — and this is the branch that makes a complete
  // page grid reachable at all.
  //
  // The scope-wide verdict is an AND over every page ("measured everywhere, or nothing", see
  // renderedProves), so it says NOTHING about a page it did not measure everywhere: one
  // contrast failure on one route makes the criterion NC for the whole run, and a probe that
  // skipped one route leaves it « to assess » for all of them. Projected back onto a page, both
  // outcomes read as silence and came back « to assess » — on pages the probes had actually
  // zoomed, reflowed, tabbed through and measured. Measured on egapro: 7 of the home page's 9
  // undecided criteria were exactly that.
  //
  // So: if the rendered tier measured THIS criterion on THIS page and raised nothing here, the
  // page conforms on it. Same claim `finalize` makes scope-wide, same fold, one page.
  //
  // IT SITS ABOVE the run-wide `manual` short-circuit, because that line's premise — "the
  // engine cannot decide it anywhere" — is exactly what a page-level measurement refutes. And
  // it defers to `decidedBy`: an agent that ruled « undecidable » examined the criterion and
  // said so, and a rule measuring something narrower must not overturn that.
  if (c.decidedBy === undefined && basis === "snapshot" && automatability(c.id) === "needs-rendering" && renderedProvesOn(c.id, coverage)) return "C";
  if (c.status === "manual") return "manual"; // the engine cannot decide it anywhere
  if (c.status === "NA") return "NA"; // legacy audits only — the engine no longer emits it
  // NOTHING OF THAT KIND EXISTS ANYWHERE IN SCOPE, so there is none on this page either.
  //
  // Checked BEFORE rule 3 below, and it is not an exception to it: rule 3 refuses to conclude
  // from silence, and this is not silence — it is a scope-wide absence the engine can point at,
  // carrying the justification that names the subject it looked for. Left to fall through, every
  // media, table and form criterion came back « à évaluer » on each page while the run-wide grid
  // had them settled: measured on a three-page sample, 75 of 106 RGAA criteria open per page
  // against 26 for the run.
  if (c.inapplicable) return c.status;

  // A verdict SOMEBODY RECORDED is not silence, and rule 3 below is only about silence.
  //
  // `decidedBy` is set in exactly two places: `applyAdjudication`, where an agent ruled with
  // citations the fold re-grounded, and the rendered tier, where every rule carrying the
  // criterion ran on every page and raised nothing. Neither is "no finding fired here". Left
  // to fall through, every such verdict was flattened back to « à évaluer » on every page, so
  // a WCAG-standard consumer could adjudicate a whole grid and see none of it in its page
  // sheets. (A pack consumer already saw them: derivePackResults applies packAdjudication
  // before deriving. This closes the same hole on the core path.)
  //
  // The scope caveat is real and stated in the report rather than hidden here: an adjudicated
  // verdict is scope-wide, so it shows on every page including ones its citations have
  // nothing to do with. That is what makes a complete page grid reachable at all, and it is
  // labelled as a scope-wide decision where it is rendered.
  if (c.decidedBy === "agent" || c.decidedBy === "scan") return c.status;

  // 3. SILENCE ONLY DECIDES WHAT THE ENGINE CAN DECIDE.
  //
  // A scope-wide `NC` on a JUDGMENT criterion does not mean the engine can rule on it — it
  // means one definite failure fired somewhere. On a page where that failure did not fire,
  // the engine knows "no definite failure here", which is not the same as "conforming": alt
  // relevance, link purpose and reading order are still nobody's verdict yet.
  //
  // Reading `NC` scope-wide as `C` on every other page is how a page with no images used to
  // score 100% on « chaque image a-t-elle une alternative pertinente ? » — a rate computed
  // over criteria nobody assessed. Only the criteria the engine genuinely decides (the
  // `static` set: applicability predicate + rules, src/audit.ts APPLICABLE) earn a verdict
  // by silence; every other criterion stays « à évaluer », which is what it is.
  if (automatability(c.id) !== "static") return "manual";

  // Decidable, and clean on this page — but only a snapshot proves the rules actually ran
  // against THIS page's DOM.
  return basis === "snapshot" ? "C" : "manual";
}

/** Why THIS page conforms on a criterion the run as a whole did not settle: because the
 *  rendered tier measured it here. Names the instrument, so the claim stays falsifiable —
 *  a reader can go and check that the probe or the rule really ran on this snapshot. */
function measuredHereReason(sc: string, cov: PageCoverage | undefined): string {
  if (cov?.scs?.includes(sc)) {
    return `Measured in a real browser ON THIS PAGE — the probe acted on it (zoom, 320px viewport, text-spacing override, Tab, hover) and observed nothing. The criterion is non-conforming elsewhere in scope; here it was measured, and it passed.`;
  }
  if (cov?.axe) {
    return `Measured by axe-core ON THIS PAGE — it ran in the browser against this page's DOM and reported nothing. The criterion is non-conforming elsewhere in scope; here it was measured, and it passed.`;
  }
  const rules = renderedRulesFor(sc);
  return `Measured on this page's rendered snapshot: ${rules.join(", ")} ran against its computed styles and boxes and raised nothing. The criterion is non-conforming elsewhere in scope; here it was measured, and it passed.`;
}

/** Pass rate over the criteria this page actually decided — same C ÷ (C + NC) basis as core.
 *
 *  NULL WHEN THE DENOMINATOR IS EMPTY, and that is the whole point. The old convention returned
 *  100 for "nothing decided", which reads as a perfect page and is the mechanism behind a 38-row
 *  table of « 100 % » for an app a human auditor had just found sixteen non-conformities in: the
 *  criteria were all « à évaluer », so C + NC was zero, so the rate was 100. A rate over nothing
 *  is not a good score, it is the absence of a score, and it must be rendered as such. */
function pct(criteria: CriterionResult[]): { rate: number | null; decided: number; total: number } {
  const c = criteria.filter((x) => x.status === "C").length;
  const nc = criteria.filter((x) => x.status === "NC").length;
  const decided = c + nc;
  return { rate: decided === 0 ? null : Math.round((c / decided) * 100), decided, total: criteria.length };
}

/** Project the audit onto its pages. Pure: everything it needs is on the AuditResult, so the
 *  grid rebuilds from a committed audit.json with no snapshots and no browser. */
export function derivePages(result: AuditResult, pages: PageScope[]): PageResult[] {
  if (!pages.length) return [];
  const out: PageResult[] = [];
  for (const p of pages) {
    const own = result.findings.filter((f) => f.page === p.id);
    const criteria: CriterionResult[] = result.criteria.map((c) => {
      const pf = own.filter((f) => f.criteriaId === c.id);
      const status = pageStatus(c, pf, p.basis, p.coverage);
      // A `C` this page earned from its OWN measurement, on a criterion the run as a whole did
      // not settle, is a scan verdict and must say so — `decidedBy` is what tells a reader (and
      // `derivePackResults`) that a status was measured rather than inferred from silence. Its
      // justification is re-derived too: the scope-wide one says why the criterion stayed OPEN
      // ("probed on 19 of the 20 pages"), which is the opposite of what happened here.
      const measured = status === "C" && c.status !== "C" && c.decidedBy === undefined;
      const decidedBy = c.decidedBy ?? (measured ? "scan" : undefined);
      const justification = measured ? measuredHereReason(c.id, p.coverage) : c.justification;
      return {
        id: c.id,
        guideline: c.guideline,
        status,
        findings: pf,
        ...(justification ? { justification } : {}),
        ...(decidedBy ? { decidedBy } : {}),
        // Carried, not recomputed: a finding on THIS page proves the subject exists after all,
        // and `pageStatus` has already turned that into an NC above.
        ...(c.inapplicable && status === c.status ? { inapplicable: true } : {}),
      };
    });
    const { rate, decided, total } = pct(criteria);
    out.push({
      id: p.id,
      name: p.name,
      url: p.url,
      ...(p.auth !== undefined ? { auth: p.auth } : {}),
      basis: p.basis,
      criteria,
      findings: own,
      conformancePct: rate,
      decided,
      total,
    });
  }
  return out;
}

// ---- rendering ---------------------------------------------------------------------------

const MARK: Record<Status, string> = { C: "C", NC: "NC", NA: "—", manual: "?" };

const L = {
  fr: {
    title: "Grille par page",
    note: "Statut de chaque critère, page par page. `C` conforme · `NC` non conforme · `—` non applicable · `?` à évaluer.",
    criterion: "Critère",
    theme: "Thématique",
    none: "Aucune page dans le périmètre : aucun instantané (.ultra11y/pages) ni échantillon scanné.",
    basisNote:
      "Une page marquée « source » n'a pas d'instantané : ses constats proviennent du code, donc l'absence de constat n'y vaut PAS conformité — les critères restent « à évaluer ».",
    unattributed: (n: number) =>
      `${n} constat(s) non rattaché(s) à une page (code partagé, fichier hors routes) — comptés dans l'audit global, jamais répartis d'office.`,
    rate: "Taux",
    snapshot: "instantané",
    source: "source",
    notAudited: "non audité",
    notAuditedNote:
      "Une page marquée « non audité » a bien un instantané, mais CET audit ne l'a pas lu (il ne portait que sur les sources). L'absence de constat n'y vaut donc PAS conformité — relancez l'audit en incluant `.ultra11y/pages`.",
    agentMark: "`C*` : conformité tranchée par l'agent IA à partir des évidences citées (gaté), et non prouvée par le moteur déterministe.",
    originNote: (o: string) => `Les colonnes sont les URL des pages, relatives à \`${o}\`.`,
  },
  en: {
    title: "Per-page grid",
    note: "Each criterion's status, page by page. `C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess.",
    criterion: "Criterion",
    theme: "Theme",
    none: "No page in scope: no snapshot (.ultra11y/pages) and no scanned sample.",
    basisNote:
      'A page marked "source" has no snapshot: its findings come from the code, so the absence of a finding there does NOT mean conforming — those criteria stay "to assess".',
    unattributed: (n: number) =>
      `${n} unattributed finding(s) (shared code, file outside any route) — counted in the overall audit, never spread across pages.`,
    rate: "Rate",
    snapshot: "snapshot",
    source: "source",
    notAudited: "not audited",
    notAuditedNote:
      'A page marked "not audited" does have a snapshot, but THIS audit never read it (it covered sources only). Absence of a finding there does NOT mean conforming — re-run the audit with `.ultra11y/pages` in scope.',
    agentMark: "`C*`: conformity ruled by the AI agent from the evidence it cited (gated), not proven by the deterministic engine.",
    originNote: (o: string) => `Columns are the pages' URLs, relative to \`${o}\`.`,
  },
} as const;

/** A page's rate, as the reader must see it: never a bare number.
 *
 *  `50 % (2/106)` when something was decided, `— (0/106)` when nothing was. The denominator is
 *  not decoration — a rate quoted without it is how « 100 % » travelled out of an index and into
 *  a PR while the sheet it came from said two criteria out of a hundred and six had been
 *  assessed. Exported so the grid, the report index, the PR comment and the dev dashboard all
 *  format it identically; a surface that prints its own is a surface that will drift. */
export function formatRate(rate: number | null, decided: number, total: number): string {
  return `${rate === null ? "—" : `${rate} %`} (${decided}/${total})`;
}

/** Honesty rule 3, as one sentence: a conformity an agent RULED is not a conformity the engine
 *  PROVED. The rate counts both — excluding the ruled ones would put the CI surfaces at odds
 *  with the report they summarize — so every surface that prints such a rate carries the `*`
 *  and this legend. One string, four readers. */
export function agentMarkNote(lang: Lang): string {
  return L[lang].agentMark;
}

/** Honesty rule 2, as one sentence: a page with no snapshot cannot earn conformity by
 *  silence. Exported so the grid, the per-page report AND the page-grain ticket all say the
 *  SAME thing — one string, several readers, no drift. Undefined for a snapshot page, which
 *  needs no caveat. */
export function pageBasisWarning(basis: PageScope["basis"], lang: Lang): string | undefined {
  if (basis === "snapshot") return undefined;
  return basis === "not-audited" ? L[lang].notAuditedNote : L[lang].basisNote;
}

/** The one-word label for a page's basis, so no surface invents its own. A "not-audited" page
 *  must NOT read as "source": it has a snapshot, and saying otherwise is a different untruth. */
export function basisLabel(basis: PageScope["basis"], lang: Lang): string {
  const s = L[lang];
  return basis === "snapshot" ? s.snapshot : basis === "not-audited" ? s.notAudited : s.source;
}

/** Honesty rule 1, as one sentence: findings no page could claim are reported, never spread. */
export function unattributedNote(n: number, lang: Lang): string {
  return L[lang].unattributed(n);
}

/** THE COLUMN HEADER OF THE CRITERIA × PAGES MATRIX: the page's URL.
 *
 *  It used to be the page's NAME, and a name is not an address. Two routes of the same app are
 *  routinely called « Accueil » and « Accueil (connecté) »; a `<title>` is written for a browser
 *  tab, not for a column; and the reader of a per-page grid is looking for the page they are
 *  about to go and fix. The URL is the only column header that says which page a cell is about
 *  without the reader having to guess.
 *
 *  The PATH, when every page shares one origin — which is what a crawl of one site produces, so
 *  it is the ordinary case. `http://127.0.0.1:8932/mentions-legales.html` repeated across nine
 *  columns is a table nobody can read; `/mentions-legales.html` is the same fact, and the origin
 *  is stated once in `pageOriginNote` beneath the grid. A mixed-origin run keeps full URLs,
 *  because there the origin IS part of the identity.
 *
 *  Exported for the same reason `formatRate` and `basisLabel` are: the Markdown grid, the HTML
 *  grid and the pull-request grid all draw this header, and a surface that composes its own is
 *  a surface that will drift from the other two. */
export function pageColumnLabel(page: { url: string; auth?: boolean }, origin?: string): string {
  let label = page.url;
  if (origin && page.url.startsWith(origin)) {
    const rest = page.url.slice(origin.length);
    label = rest === "" ? "/" : rest;
  }
  return `${label}${page.auth ? " 🔒" : ""}`;
}

/** The one origin every page in scope shares, or undefined when they do not share one.
 *
 *  `undefined` is a real answer and not a failure: a run that spans two hosts must show both in
 *  full, and a run over `file://` captures or source-attributed pages has no origin at all. */
export function commonOrigin(pages: { url: string }[]): string | undefined {
  if (!pages.length) return undefined;
  let origin: string | undefined;
  for (const p of pages) {
    let o: string;
    try {
      o = new URL(p.url).origin;
    } catch {
      return undefined; // not an absolute URL — a source-attributed page, or a bare route
    }
    if (origin === undefined) origin = o;
    else if (origin !== o) return undefined;
  }
  return origin;
}

/** « Les colonnes sont les URL … » — the sentence that says what the column headers are and,
 *  when they were shortened, what they were shortened against. Without it a reader of a grid
 *  headed `/tarifs.html` has no way to know which host it is a path of. */
export function pageOriginNote(origin: string | undefined, lang: Lang): string | undefined {
  return origin ? L[lang].originNote(origin) : undefined;
}

/** One criterion's row in the cross-page grid: its id, its rendered label, and the group
 *  heading it sits under (a WCAG guideline, or a pack theme). */
export interface PageGridRow {
  id: string;
  label: string;
  group: string;
}

/** The criterion rows of the cross-page grid, and each page's status for each of them. */
export interface PageGridModel {
  rows: PageGridRow[];
  /** rowId → pageId → status. Absent ⇒ `manual`; the renderer, not the model, picks the mark. */
  status: Map<string, Map<string, Status>>;
}

/** A view of the audit restricted to ONE page: the same shape, with this page's criterion
 *  statuses and findings. Feeding it to `derivePackResults` is what makes the grid agree with
 *  the report BY CONSTRUCTION — out-of-scope criteria (RGAA 8.1), scoped-out siblings, pack
 *  overrides, advisory handling and secondary mappings all come from the one implementation
 *  instead of a second, drifting copy here. */
export function pageView(result: AuditResult, page: PageResult): AuditResult {
  // `subjectsSeen` is narrowed to THIS page when the audit recorded the per-page fold.
  //
  // Without it the projection asked a run-wide question of a single page — "does anything of
  // this kind exist ANYWHERE?" — so a criterion whose subject lives on one route stayed open on
  // every other one for ever: absence could not be concluded, and a `judgment` criterion never
  // earns a `C` by silence either. RGAA 8.4 on the one page declaring no language was exactly
  // that, and no adjudication could reach it.
  //
  // Only EXISTENCE_SUBJECTS can conclude anything from this (subjectsAbsent), and those are
  // element species whose absence on a page is a fact a reader can check. The site-level
  // criteria are untouched by construction: RGAA 12.1–12.5 declare `navMechanisms` /
  // `repeatedBlocks`, neither of which is an existence subject, so narrowing can never close
  // « the ensemble has two navigation systems » on a page that happens to carry one.
  //
  // Absent map ⇒ unchanged behaviour, so an audit written before the fold reads as it always did.
  const own = result.scope.pageSubjects?.[page.id];
  return {
    ...result,
    ...(own ? { scope: { ...result.scope, subjectsSeen: own } } : {}),
    criteria: page.criteria,
    findings: page.findings,
    ...(result.packFindings ? { packFindings: result.packFindings.filter((f) => f.page === page.id) } : {}),
  };
}

/** The criterion rows to render, and each page's status for them.
 *
 *  Exported because the Markdown grid, the dev side-car dashboard and the HTML report all draw
 *  the same table: three copies of this loop is three chances to disagree about what a page's
 *  status IS. Every status still comes from `derivePackResults` over a `pageView`, never from a
 *  local re-derivation. */
export function pageGridModel(result: AuditResult, derived: PageResult[], standard: StandardId, lang: Lang): PageGridModel {
  const status = new Map<string, Map<string, Status>>(); // rowId → pageId → status
  const put = (rowId: string, pageId: string, s: Status): void => {
    const m = status.get(rowId) ?? new Map<string, Status>();
    m.set(pageId, s);
    status.set(rowId, m);
  };

  if (isCore(standard)) {
    const rows = [...result.criteria]
      .sort((a, b) => compareSC(a.id, b.id))
      .map((c) => ({ id: c.id, label: `${c.id} ${scTitle(c.id, lang) ?? ""}`.trim(), group: c.guideline }));
    for (const p of derived) for (const c of p.criteria) put(c.id, p.id, c.status);
    return { rows, status };
  }

  const pack = loadPack(standard);
  const rows = pack.criteria.map((pc) => ({ id: pc.id, label: pc.id, group: `${pc.theme}. ${themeName(pack, pc.theme, lang) ?? ""}`.trim() }));
  for (const p of derived) for (const pc of derivePackResults(pageView(result, p), standard, p.id)) put(pc.id, p.id, pc.status);
  return { rows, status };
}

/** The pages a scan REFUSED to record, named in the deliverable.
 *
 *  Honesty rule 0 (see the header) removes these from `scope.sample`, because a page kept
 *  there is re-added to the grid with the same basis as one really visited. Removing it is
 *  correct and insufficient: the report would then just be shorter than the sample the
 *  project declares, and a silently shorter report reads as a complete one. So the drop is
 *  stated — which page, where it went, and why — because that is what makes it fixable.
 *
 *  The notice says "page(s)", not "sample page(s)": a crawl refuses pages too — a followed
 *  link that answers 404 — and there is no sample behind those. Naming one in an auditor's
 *  document that never declared a sample is a small false statement in a document whose
 *  whole value is that it makes none. */
export function renderRedirected(redirected: ScanRedirect[], lang: Lang = "en"): string[] {
  const fr = lang === "fr";
  const out: string[] = [
    fr
      ? `> ⚠️ **${redirected.length} page(s) n'ont pas été enregistrées** — le navigateur n'est pas resté sur l'adresse demandée. Les enregistrer aurait décrit un autre écran sous le nom demandé. Elles ne comptent donc ni comme conformes ni comme non conformes : elles manquent.`
      : `> ⚠️ **${redirected.length} page(s) were not recorded** — the browser did not stay on the address asked for. Recording them would have described another screen under the requested name. They count as neither conforming nor non-conforming: they are missing.`,
    "",
    fr ? "| Page | Demandé | Atteint | Motif |" : "| Page | Requested | Landed | Reason |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of redirected) {
    const why =
      r.reason === "http-status"
        ? fr
          ? `HTTP ${r.status ?? "≥ 400"} — page d'erreur rendue à la même adresse`
          : `HTTP ${r.status ?? "≥ 400"} — error page served at the same address`
        : r.reason === "error"
          ? fr
            ? `le navigateur a échoué sur cette page${r.detail ? ` — ${r.detail}` : ""}`
            : `the browser failed on this page${r.detail ? ` — ${r.detail}` : ""}`
          : fr
            ? "redirection"
            : "redirect";
    out.push(`| ${r.name} (\`${r.id}\`) | \`${r.requested}\` | \`${r.landed}\` | ${why} |`);
  }
  return out;
}

/** One page's standing over the rows of the grid it is printed on — same C ÷ (C + NC) basis
 *  as everywhere else, and the same NULL for "nothing decided". Taking it from the grid model
 *  rather than from `PageResult` is what makes the header a summary of the body under a pack
 *  as well as under the core: `PageResult` only ever carries the WCAG projection.
 *
 *  Returned as the argument tuple `formatRate` takes, so no caller can pair a rate with
 *  somebody else's denominator. */
export function gridRate(rows: { id: string }[], status: Map<string, Map<string, Status>>, pageId: string): [number | null, number, number] {
  let c = 0;
  let nc = 0;
  for (const row of rows) {
    const st = status.get(row.id)?.get(pageId);
    if (st === "C") c++;
    else if (st === "NC") nc++;
  }
  const decided = c + nc;
  return [decided === 0 ? null : Math.round((c / decided) * 100), decided, rows.length];
}

/** The Markdown grid: one row per criterion, one column per page. */
export function renderPageGrid(result: AuditResult, pages: PageScope[], standard: StandardId = CORE, lang: Lang = "en"): string {
  const s = L[lang];
  const out: string[] = [];
  out.push(`## 📊 ${s.title}`, "");
  const derived = derivePages(result, pages);
  if (!derived.length) {
    out.push(s.none, "");
    return out.join("\n");
  }
  out.push(`> ${s.note}`, "");
  if (derived.some((p) => p.basis === "attributed")) out.push(`> ⚠️ ${s.basisNote}`, "");

  const origin = commonOrigin(derived);
  const originNote = pageOriginNote(origin, lang);
  if (originNote) out.push(`> ${originNote}`, "");
  const head = [s.criterion, ...derived.map((p) => pageColumnLabel(p, origin))];
  out.push(`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`);
  // THE MODEL FIRST, because the rate is a summary OF THIS GRID and has to be computed from
  // the rows it is printed above. It was read off `PageResult` instead — which is always the
  // WCAG core projection — so under a pack the header and the body answered different
  // questions: measured on a two-page RGAA run, the grid listed all 106 criteria and then
  // announced « 89 % (9/55) », while the same page's own dossier said 47/106. Same command,
  // same page, two denominators; and this grid is what `comment-kind: pages` pastes onto a
  // pull request, so the wrong one was the one people read.
  const { rows, status } = pageGridModel(result, derived, standard, lang);
  out.push(`| **${s.rate}** | ${derived.map((p) => `**${formatRate(...gridRate(rows, status, p.id))}**`).join(" | ")} |`);
  out.push(`| _${s.snapshot}?_ | ${derived.map((p) => `_${basisLabel(p.basis, lang)}_`).join(" | ")} |`);

  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      out.push(`| **${group}** | ${derived.map(() => "").join(" | ")} |`);
    }
    const cells = derived.map((p) => MARK[status.get(row.id)?.get(p.id) ?? "manual"]);
    out.push(`| ${row.label} | ${cells.join(" | ")} |`);
  }
  out.push("");

  const orphans = unattributedFindings(result);
  if (orphans.length) out.push(`> ${s.unattributed(orphans.length)}`, "");
  return out.join("\n");
}
