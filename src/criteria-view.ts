// The offline reference, as DATA.
//
// `src/criteria.ts` renders the reference for a terminal: it prints and returns an exit
// code. That made the CLI the only way to reach the standard — the MCP server reimplemented
// a thin WCAG-only lookup of its own, which silently ignored `standard` and answered a
// question about RGAA with a WCAG success criterion.
//
// So the query layer lives here, the printer stays there, and both answer from the same
// data. A criterion rendered by `criteria --standard rgaa 8.3` and one returned by
// `ultra11y_criteria { standard: "rgaa", sc: "8.3" }` cannot drift, because the human string
// in `text` is produced by the very formatter the CLI prints.
import { adjudicationText } from "./adjudication-data.js";
import { resolveGuidance, type ResolvedGuidance } from "./guidance/resolve.js";
import { formatPackCriterion, formatSC } from "./criteria.js";
import {
  allCriteria,
  criterionCoverage,
  getCriterion,
  glossaryAnchorsOf,
  isCore,
  listTheme,
  loadPack,
  packGlossary,
  packsForSc,
  resolveGlossary,
  standardLabel,
  themeName,
  titlePlain,
  type Coverage,
  type PackCriterion,
  type StandardId,
  type StandardPack,
} from "./standards/index.js";
import { allGuidelines, allSC, coreGlossary, getSC, guidelineTitle, meta, principleTitle, scText, scTitle, scsByGuideline, techniquesFor } from "./wcag.js";
import type { Glossary, GlossaryEntry, Lang } from "./types.js";

/** A lookup the caller got wrong — an id that does not exist, a term nothing defines. */
export class CriteriaLookupError extends Error {
  readonly suggestions: string[];
  constructor(message: string, suggestions: string[] = []) {
    super(message);
    this.suggestions = suggestions;
  }
}

// ---- shared shapes --------------------------------------------------------

export interface GuidanceView {
  id: string;
  title?: string;
  summary?: string;
  impact?: "high" | "medium" | "low";
  reference: string;
  wcag: string[];
  /** "pack" when the standard pins it here; "wcag:<sc>" when inherited via the mapping. */
  via: string;
  inherited: boolean;
  /** The languages this entry has text in — it may not include the one you asked for. */
  languagesAvailable: Lang[];
  examples: { lang: string; bad?: string; good?: string; note?: string }[];
}

export interface GlossaryTermView {
  anchor: string;
  title: string;
  body: string;
}

export interface AdjudicationView {
  sc: string;
  decide: string;
  na?: string;
  questions: string[];
}

function guidanceView(r: ResolvedGuidance, lang: Lang): GuidanceView {
  const e = r.entry;
  return {
    id: e.id,
    ...(e.title?.[lang] ? { title: e.title[lang] } : {}),
    ...(e.summary?.[lang] ? { summary: e.summary[lang] } : {}),
    ...(e.impact ? { impact: e.impact } : {}),
    reference: e.reference,
    wcag: e.wcag,
    via: r.via,
    inherited: r.inherited,
    languagesAvailable: r.languagesAvailable,
    examples: (e.examples ?? []).map((x) => ({
      lang: x.lang,
      ...(x.bad ? { bad: x.bad } : {}),
      ...(x.good ? { good: x.good } : {}),
      ...(x.note?.[lang] ? { note: x.note[lang] } : {}),
    })),
  };
}

function glossaryViews(pack: StandardPack, c: PackCriterion): GlossaryTermView[] {
  const out: GlossaryTermView[] = [];
  for (const anchor of glossaryAnchorsOf(c)) {
    const entry: GlossaryEntry | undefined = resolveGlossary(pack.key, anchor);
    if (entry) out.push({ anchor, title: entry.title, body: entry.body });
  }
  return out;
}

// ---- one criterion --------------------------------------------------------

export interface ScCriterionView {
  kind: "wcag";
  sc: string;
  title: string;
  titleLocalized?: string;
  /** The criterion's normative wording, verbatim from the W3C source. */
  text?: string;
  /** The terms the wording leans on, with WCAG's own definitions. */
  glossary: GlossaryTermView[];
  level: string;
  addedIn: string;
  principle: { number: number; title?: string };
  guideline: { number: string; title?: string };
  automatability: string;
  coverage: Coverage;
  techniques: string[];
  understanding: string;
  adjudication?: { decide: string; na?: string; questions: string[] };
  mappedBy: { standard: string; criteria: string[] }[];
  guidance: GuidanceView[];
}

export interface PackCriterionView {
  kind: "pack";
  id: string;
  theme: { number: number; name?: string };
  title: string;
  titleRaw?: string;
  tests: { id: string; lines: string[] }[];
  techniques: string[];
  wcag: { sc: string; title?: string; level?: string; automatability?: string; inCore: boolean }[];
  technicalNote: string[];
  particularCases: string[];
  judgment: boolean;
  appliesTo: string[];
  coverage: Coverage;
  glossary: GlossaryTermView[];
  adjudication: AdjudicationView[];
  guidance: GuidanceView[];
}

export interface CriterionResultView {
  standard: StandardId;
  standardLabel: string;
  lang: Lang;
  kind: "criterion";
  /** The id as asked for. Kept as `sc` too, for the WCAG case, by the caller. */
  id: string;
  criterion: ScCriterionView | PackCriterionView;
  /** Exactly what `criteria [--standard <s>] <id>` prints. */
  text: string;
}

function scView(id: string, lang: Lang, includeGuidance: boolean): ScCriterionView | undefined {
  const c = getSC(id);
  if (!c) return undefined;
  const localized = scTitle(c.sc, lang);
  return {
    kind: "wcag",
    sc: c.sc,
    title: c.title,
    ...(localized && localized !== c.title ? { titleLocalized: localized } : {}),
    ...(scText(c.sc, lang) ? { text: scText(c.sc, lang) } : {}),
    // The terms the wording links to. WCAG's definitions are normative in exactly the way
    // a pack's are: "large scale" and "pure decoration" mean what the glossary says.
    glossary: ((lang === "fr" ? c.termsFr : c.terms) ?? []).flatMap((slug) => {
      const entry = coreGlossary(lang)[slug];
      return entry ? [{ anchor: slug, title: entry.title, body: entry.body }] : [];
    }),
    level: c.level,
    addedIn: c.addedIn,
    principle: { number: c.principle, ...(principleTitle(c.principle, lang) ? { title: principleTitle(c.principle, lang) } : {}) },
    guideline: { number: c.guideline, ...(guidelineTitle(c.guideline, lang) ? { title: guidelineTitle(c.guideline, lang) } : {}) },
    automatability: c.automatability,
    coverage: criterionCoverage("wcag", c.sc)!,
    techniques: techniquesFor(c.sc),
    understanding: c.understanding,
    // The decision protocol stands in for the Understanding prose this repo deliberately
    // does not vendor: what makes it Conforming, when NA is legitimate, what to ask.
    ...(adjudicationText(c.sc, lang) ? { adjudication: adjudicationText(c.sc, lang) } : {}),
    mappedBy: packsForSc(c.sc).map((p) => ({ standard: p.key, criteria: p.ids })),
    guidance: includeGuidance ? resolveGuidance("wcag", c.sc).map((r) => guidanceView(r, lang)) : [],
  };
}

function packCriterionView(pack: StandardPack, c: PackCriterion, lang: Lang, includeGuidance: boolean): PackCriterionView {
  const plain = titlePlain(pack, c, lang);
  const raw = c.title?.[lang] ?? c.title?.[pack.defaultLocale];
  const adjudication: AdjudicationView[] = [];
  for (const sc of c.wcag) {
    const p = adjudicationText(sc, lang);
    if (p) adjudication.push({ sc, ...p });
  }
  return {
    kind: "pack",
    id: c.id,
    theme: { number: c.theme, ...(themeName(pack, c.theme, lang) ? { name: themeName(pack, c.theme, lang) } : {}) },
    title: plain,
    // The markup is kept, not stripped: `[terme](#ancre)` is what points at the normative
    // glossary definitions attached below.
    ...(raw && raw !== plain ? { titleRaw: raw } : {}),
    tests: Object.entries(c.tests ?? {}).map(([k, lines]) => ({ id: `${c.id}.${k}`, lines })),
    techniques: c.techniques ?? [],
    wcag: c.wcag.map((sc) => {
      const core = getSC(sc);
      return {
        sc,
        ...(core ? { title: scTitle(sc, lang) ?? core.title, level: core.level, automatability: core.automatability } : {}),
        inCore: core !== undefined,
      };
    }),
    technicalNote: c.technicalNote ?? [],
    particularCases: c.particularCases ?? [],
    judgment: c.judgment === true,
    appliesTo: c.appliesTo?.ruleIds ?? [],
    coverage: criterionCoverage(pack.key, c.id)!,
    glossary: glossaryViews(pack, c),
    adjudication,
    guidance: includeGuidance ? resolveGuidance(pack.key, c.id).map((r) => guidanceView(r, lang)) : [],
  };
}

/** One criterion of any standard. Throws `CriteriaLookupError` when the id does not exist. */
export function criterionView(standard: StandardId, id: string, lang: Lang, includeGuidance = false): CriterionResultView {
  const base = { standard, standardLabel: standardLabel(standard), lang, kind: "criterion" as const, id };
  if (isCore(standard)) {
    const view = scView(id, lang, includeGuidance);
    if (!view) throw new CriteriaLookupError(`no such success criterion: ${id}. List them all by omitting \`sc\`.`);
    return { ...base, criterion: view, text: formatSC(getSC(id)!, lang) };
  }
  const pack = loadPack(standard);
  const c = getCriterion(pack, id);
  if (!c) throw new CriteriaLookupError(`no such ${pack.name} criterion: ${id}. List them all by omitting \`sc\`.`);
  return { ...base, criterion: packCriterionView(pack, c, lang, includeGuidance), text: formatPackCriterion(pack, c, lang) };
}

// ---- the index ------------------------------------------------------------

export interface IndexResultView {
  standard: StandardId;
  standardLabel: string;
  lang: Lang;
  kind: "index";
  counts: Record<string, number>;
  byTier: Record<string, number>;
  /** WCAG: the guidelines. A pack: its themes. */
  groups: { number: string; name?: string; count: number }[];
  criteria: {
    id: string;
    title: string;
    group: string;
    level?: string;
    wcag?: string[];
    tier: string;
    sourceIsEnough: boolean;
    judgment?: boolean;
  }[];
  /** Present for a pack: everything a client needs to cite the standard properly. */
  pack?: Record<string, unknown>;
  /** Present for the core. */
  meta?: Record<string, unknown>;
}

function tierCensus(standard: StandardId, ids: string[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const id of ids) {
    const t = criterionCoverage(standard, id)?.tier;
    if (t) by[t] = (by[t] ?? 0) + 1;
  }
  return by;
}

export function criteriaIndex(standard: StandardId, lang: Lang): IndexResultView {
  const base = { standard, standardLabel: standardLabel(standard), lang, kind: "index" as const };
  if (isCore(standard)) {
    const scs = allSC();
    const byGuideline = scsByGuideline();
    const byAuto: Record<string, number> = {};
    for (const c of scs) byAuto[c.automatability] = (byAuto[c.automatability] ?? 0) + 1;
    return {
      ...base,
      meta: { ...meta() },
      counts: { criteria: scs.length, ...byAuto },
      byTier: tierCensus(
        "wcag",
        scs.map((c) => c.sc),
      ),
      groups: allGuidelines().map((g) => ({
        number: g.number,
        ...(guidelineTitle(g.number, lang) ? { name: guidelineTitle(g.number, lang) } : {}),
        count: byGuideline.get(g.number)?.length ?? 0,
      })),
      criteria: scs.map((c) => {
        const cov = criterionCoverage("wcag", c.sc)!;
        return {
          id: c.sc,
          title: scTitle(c.sc, lang) ?? c.title,
          group: c.guideline,
          level: c.level,
          tier: cov.tier,
          sourceIsEnough: cov.sourceIsEnough,
        };
      }),
    };
  }

  const pack = loadPack(standard);
  const criteria = allCriteria(pack);
  const tests = criteria.reduce((n, c) => n + Object.keys(c.tests ?? {}).length, 0);
  return {
    ...base,
    pack: {
      key: pack.key,
      name: pack.name,
      fullName: pack.fullName,
      org: pack.org,
      country: pack.country,
      baseVersion: pack.baseVersion,
      wcagVersion: pack.wcagVersion,
      locales: pack.locales,
      defaultLocale: pack.defaultLocale,
      license: pack.license,
      source: pack.source,
      attribution: pack.attribution,
    },
    counts: {
      themes: pack.themes.length,
      criteria: criteria.length,
      tests,
      judgment: criteria.filter((c) => c.judgment).length,
      noEngineRule: criteria.filter((c) => c.appliesTo?.ruleIds?.length === 0).length,
    },
    byTier: tierCensus(
      pack.key,
      criteria.map((c) => c.id),
    ),
    groups: pack.themes.map((t) => ({
      number: String(t.number),
      ...(themeName(pack, t.number, lang) ? { name: themeName(pack, t.number, lang) } : {}),
      count: t.count,
    })),
    criteria: criteria.map((c) => {
      const cov = criterionCoverage(pack.key, c.id)!;
      return {
        id: c.id,
        title: titlePlain(pack, c, lang),
        group: String(c.theme),
        wcag: c.wcag,
        tier: cov.tier,
        sourceIsEnough: cov.sourceIsEnough,
        judgment: c.judgment === true,
      };
    }),
  };
}

// ---- one theme ------------------------------------------------------------

export function themeView(standard: StandardId, n: number, lang: Lang): Record<string, unknown> {
  if (isCore(standard)) {
    throw new CriteriaLookupError("WCAG has no themes — it groups criteria by guideline. Omit `theme`, or pass a country standard.");
  }
  const pack = loadPack(standard);
  const criteria = listTheme(pack, n);
  if (!criteria.length) throw new CriteriaLookupError(`no such ${pack.name} theme: ${n}.`);
  return {
    standard,
    standardLabel: standardLabel(standard),
    lang,
    kind: "theme",
    theme: { number: n, ...(themeName(pack, n, lang) ? { name: themeName(pack, n, lang) } : {}), count: criteria.length },
    criteria: criteria.map((c) => {
      const cov = criterionCoverage(pack.key, c.id)!;
      return {
        id: c.id,
        title: titlePlain(pack, c, lang),
        wcag: c.wcag,
        tier: cov.tier,
        sourceIsEnough: cov.sourceIsEnough,
        judgment: c.judgment === true,
      };
    }),
  };
}

// ---- the glossary ---------------------------------------------------------

/** Accent- and case-insensitive folding, so "Légende" finds "legende-d-image". */
export function foldTerm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Which criteria of this standard cite a glossary anchor in their tests. */
function citedBy(pack: StandardPack, anchor: string): string[] {
  return allCriteria(pack)
    .filter((c) => glossaryAnchorsOf(c).includes(anchor))
    .map((c) => c.id);
}

/**
 * The glossary of any standard. The core reads its own vendored terms; a pack reads the
 * `<key>.glossary.json` registered beside it. One seam, so `--standard wcag --glossary` is
 * the same call as `--standard rgaa --glossary`.
 */
function glossaryOf(standard: StandardId, lang: Lang): { glossary: Glossary; label: string } {
  if (isCore(standard)) return { glossary: coreGlossary(lang), label: standardLabel(standard) };
  return { glossary: packGlossary(standard) ?? {}, label: loadPack(standard).name };
}

export function glossaryView(standard: StandardId, term?: string, lang: Lang = "en"): Record<string, unknown> {
  const { glossary, label } = glossaryOf(standard, lang);
  const anchors = Object.keys(glossary).sort();
  // An empty glossary is stated, never returned as an empty list: "this standard defines
  // no terms" and "this build ships none of them" are different claims.
  if (!anchors.length) throw new CriteriaLookupError(`${label} ships no glossary in this build.`);

  const wanted = term?.trim();
  if (!wanted) {
    return {
      standard,
      standardLabel: standardLabel(standard),
      kind: "glossary-index",
      count: anchors.length,
      terms: anchors.map((a) => ({ anchor: a, title: glossary[a]?.title ?? "" })),
    };
  }

  const want = foldTerm(wanted);
  // Exact anchor, then exact folded title, then a prefix match — never a fuzzy guess that
  // could hand back the definition of a DIFFERENT normative term.
  const hit =
    anchors.find((a) => a === wanted) ??
    anchors.find((a) => foldTerm(a) === want) ??
    anchors.find((a) => foldTerm(glossary[a]?.title ?? "") === want) ??
    anchors.find((a) => foldTerm(a).startsWith(want));
  if (!hit) {
    const near = anchors.filter((a) => foldTerm(a).includes(want) || foldTerm(glossary[a]?.title ?? "").includes(want)).slice(0, 8);
    throw new CriteriaLookupError(`no ${label} glossary term matching "${wanted}".`, near);
  }
  const entry = glossary[hit]!;
  return {
    standard,
    standardLabel: standardLabel(standard),
    kind: "glossary-term",
    anchor: hit,
    title: entry.title,
    body: entry.body,
    // Which criteria this definition actually governs — the reason it is normative.
    citedBy: isCore(standard) ? [] : citedBy(loadPack(standard), hit),
  };
}
