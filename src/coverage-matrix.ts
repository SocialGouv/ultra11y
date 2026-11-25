// THE COVERAGE MATRIX — which evidence source can reach each criterion, and through what.
//
// `criteria --plan` (src/standards/coverage.ts) answers « what is the cheapest tier that can
// prove this criterion conformant ». This answers the question one level down, the one an audit
// that has to DECIDE all 106 criteria asks first: for each criterion, which producer of evidence
// actually hands the adjudicator something to rule on — and a criterion that no producer reaches
// is a criterion that can only ever stay « à évaluer », or be ruled on nothing.
//
// The five sources are the producers this engine ships:
//
//   static     — the source tree, read by `audit` (static and cross-file rules, and the markup
//                subjects of the adjudication harvest run over source files);
//   render     — ultra11y's own render engine (`render`, src/render-engine.ts): component and
//                page captures under `.ultra11y/captures`, audited by the same markup rules and
//                subjects — except the document-level ones, which a fragment cannot carry;
//   snapshot   — a captured page (`.ultra11y/pages/<id>/`): its DOM and the digests beside it
//                (styles, boxes, css, doctype), read offline by the rendered rules and subjects;
//   journey    — a live browser acting on the page, `scan` and `journey run`: axe, the probes,
//                the behaviour window, the accessibility tree read out as a screen reader would
//                (`sr.json`) and the media probe (`media.json`), on every page state;
//   judgement  — the adjudicator (`verify --manual`) ruling a criterion on that evidence. A
//                judgement path exists only where some other source harvests something for it:
//                a criterion with nothing to look at has no judgement path either.
//
// Every path names what carries it — a rule id or a harvest subject — so the matrix is a lookup
// over the engine's own tables, never over the wording of a test, and
// tests/coverage-matrix.test.ts fails the build when a criterion of a shipped standard has none.
import { SUBJECTS, subjectsForPackCriterion, subjectsForSc } from "./adjudicate-subjects.js";
import { ALL_RULES } from "./rules/registry.js";
import { standardCoverage, ruleTier } from "./standards/coverage.js";
import type { Tier } from "./standards/coverage.js";
import { allCriteria } from "./standards/pack.js";
import { isCore, loadPack } from "./standards/registry.js";
import type { StandardId } from "./standards/index.js";
import { allSC } from "./wcag.js";

export const EVIDENCE_SOURCES = ["static", "render", "snapshot", "journey", "judgement"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface EvidencePath {
  source: EvidenceSource;
  /** `rule:<id>` or `subject:<id>`, or `verify --manual` for a judgement path. */
  via: string;
}

export interface CriterionPaths {
  id: string;
  /** The plan's tier for it (src/standards/coverage.ts), for the reader. */
  tier: Tier;
  /** Each source once, in EVIDENCE_SOURCES order. */
  sources: EvidenceSource[];
  paths: EvidencePath[];
}

/** Subjects that read a capture's digests and nothing else: no source file carries them. */
const CAPTURE_ONLY_SUBJECTS = new Set(["doctype", "computedColours"]);
/** Subjects about the whole document — a component fragment rendered alone carries none of them. */
const DOCUMENT_SUBJECTS = new Set(["doctype", "docTitle", "docLang", "declaredLang", "siteMapPage", "markupValidity"]);
/** Subjects whose evidence a live browser produces (probe measures, axe, behaviour, the
 *  accessibility tree, the media probe), beside whatever else they read. */
const BROWSER_SUBJECT = /^(?:rendered|behaviour|sr):/;
const BROWSER_ENRICHED_SUBJECTS = new Set(["flashes", "temporalMedia"]);

const PAGE_SCOPE_RULES = new Set(ALL_RULES.filter((r) => r.scope === "page").map((r) => r.id));

/** The sources a harvest subject reaches a criterion from. */
export function subjectSources(id: string): EvidenceSource[] {
  if (BROWSER_SUBJECT.test(id)) return ["snapshot", "journey"];
  const out: EvidenceSource[] = [];
  if (!CAPTURE_ONLY_SUBJECTS.has(id)) out.push("static");
  if (!CAPTURE_ONLY_SUBJECTS.has(id) && !DOCUMENT_SUBJECTS.has(id)) out.push("render");
  out.push("snapshot");
  if (BROWSER_ENRICHED_SUBJECTS.has(id)) out.push("journey");
  return out;
}

/** The sources an engine rule reaches a criterion from, by the tier its namespace belongs to. */
export function ruleSources(ruleId: string, standard: StandardId): EvidenceSource[] {
  const tier = ruleTier(ruleId, isCore(standard) ? undefined : loadPack(standard));
  if (tier === "judgment") return ["judgement"];
  if (tier === "browser") return ["journey"];
  if (tier === "rendered-page") return ["snapshot"];
  if (tier === "cross-file") return ["static"];
  // A static rule runs on every parsed document: source, a rendered component, a page capture.
  // A page-scope rule (html-lang, title, viewport) needs a whole document, which a component
  // capture is not.
  const bare = ruleId.replace(/\*$/, "");
  return PAGE_SCOPE_RULES.has(bare) ? ["static", "snapshot"] : ["static", "render", "snapshot"];
}

const order = (s: EvidenceSource[]): EvidenceSource[] => EVIDENCE_SOURCES.filter((x) => s.includes(x));

/** The matrix for a standard: every criterion, with every path that reaches it. */
export function coverageMatrix(standard: StandardId): CriterionPaths[] {
  const coverage = standardCoverage(standard);
  const rows: { id: string; rules: string[]; subjects: string[] }[] = isCore(standard)
    ? allSC().map((sc) => ({ id: sc.sc, rules: [...sc.ruleIds], subjects: subjectsForSc(sc.sc) }))
    : allCriteria(loadPack(standard)).map((pc) => ({
        id: pc.id,
        rules: [...new Set([...(pc.appliesTo?.ruleIds ?? []), ...(pc.automation?.rules ?? []).map((r) => r.id)])],
        subjects: subjectsForPackCriterion(standard, pc.id, pc.wcag),
      }));
  return rows.map(({ id, rules, subjects }) => {
    const paths: EvidencePath[] = [];
    for (const r of rules) for (const source of ruleSources(r, standard)) paths.push({ source, via: `rule:${r}` });
    for (const s of subjects) if (SUBJECTS[s]) for (const source of subjectSources(s)) paths.push({ source, via: `subject:${s}` });
    // Judgement rules on what the other sources harvested — so only where a subject exists.
    if (subjects.some((s) => SUBJECTS[s])) paths.push({ source: "judgement", via: "verify --manual" });
    return {
      id,
      tier: coverage.get(id)?.tier ?? "judgment",
      sources: order([...new Set(paths.map((p) => p.source))]),
      paths,
    };
  });
}

/** Per source, the criteria it reaches. */
export function matrixBySource(matrix: CriterionPaths[]): Record<EvidenceSource, string[]> {
  const out = Object.fromEntries(EVIDENCE_SOURCES.map((s) => [s, [] as string[]])) as Record<EvidenceSource, string[]>;
  for (const row of matrix) for (const s of row.sources) out[s].push(row.id);
  return out;
}
