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
import type { AuditResult, CriterionResult, Finding, Lang, PageResult, PageScope, Status } from "./types.js";
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
  return [...checked, ...extra];
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
function pageStatus(c: CriterionResult, pageFindings: Finding[], basis: PageScope["basis"]): Status {
  // A non-normative recommendation can never flip a criterion to NC — same rule as core.
  if (pageFindings.some((f) => !f.advisory)) return "NC";
  if (c.status === "manual") return "manual"; // the engine cannot decide it anywhere
  if (c.status === "NA") return "NA"; // not applicable in scope ⇒ not applicable here

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
      return {
        id: c.id,
        guideline: c.guideline,
        status: pageStatus(c, pf, p.basis),
        findings: pf,
        ...(c.justification ? { justification: c.justification } : {}),
        ...(c.decidedBy ? { decidedBy: c.decidedBy } : {}),
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

interface Row {
  id: string;
  label: string;
  group: string;
}

/** A view of the audit restricted to ONE page: the same shape, with this page's criterion
 *  statuses and findings. Feeding it to `derivePackResults` is what makes the grid agree with
 *  the report BY CONSTRUCTION — out-of-scope criteria (RGAA 8.1), scoped-out siblings, pack
 *  overrides, advisory handling and secondary mappings all come from the one implementation
 *  instead of a second, drifting copy here. */
export function pageView(result: AuditResult, page: PageResult): AuditResult {
  return {
    ...result,
    criteria: page.criteria,
    findings: page.findings,
    ...(result.packFindings ? { packFindings: result.packFindings.filter((f) => f.page === page.id) } : {}),
  };
}

/** The criterion rows to render, and each page's status for them. */
function gridOf(result: AuditResult, derived: PageResult[], standard: StandardId, lang: Lang): { rows: Row[]; status: Map<string, Map<string, Status>> } {
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
  for (const p of derived) for (const pc of derivePackResults(pageView(result, p), standard)) put(pc.id, p.id, pc.status);
  return { rows, status };
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

  const head = [isCore(standard) ? s.criterion : s.criterion, ...derived.map((p) => `${p.name}${p.auth ? " 🔒" : ""}`)];
  out.push(`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`);
  out.push(`| **${s.rate}** | ${derived.map((p) => `**${formatRate(p.conformancePct, p.decided, p.total)}**`).join(" | ")} |`);
  out.push(`| _${s.snapshot}?_ | ${derived.map((p) => `_${basisLabel(p.basis, lang)}_`).join(" | ")} |`);

  const { rows, status } = gridOf(result, derived, standard, lang);
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
