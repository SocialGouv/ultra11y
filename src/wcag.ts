// Loads the bundled WCAG 2.2 Level AA reference (offline, embedded by tsup) and exposes
// success-criterion / principle / guideline / technique lookups. This is the engine's
// CANONICAL key: everything downstream (audit, report, criteria, check, verify) resolves
// success criteria through here. Country standards (RGAA, …) are derived packs that map
// their criteria onto these SCs — see src/standards/.
import wcagJson from "./data/wcag.json";
import wcagUniverseJson from "./data/wcag-universe.json";
import type { WcagData, Sc, WcagPrinciple, WcagGuideline, Automatability, WcagUniverseData, ScStatus, Lang, Glossary } from "./types.js";

const data = wcagJson as unknown as WcagData;
const universe = wcagUniverseJson as unknown as WcagUniverseData;

const byId = new Map<string, Sc>(data.criteria.map((c) => [c.sc, c]));
const universeById = new Map(universe.criteria.map((c) => [c.id, c]));

export function allSC(): Sc[] {
  return data.criteria;
}

export function getSC(id: string): Sc | undefined {
  return byId.get(id);
}

export function hasSC(id: string): boolean {
  return byId.has(id);
}

/** Classify ANY real WCAG 2.x success criterion against the shipped AA core — "core-AA"
 *  (in `allSC()`), "out-of-core" (a real WCAG AAA criterion), "removed" (obsolete, e.g.
 *  4.1.1 Parsing), or `undefined` if `id` is not a real WCAG success criterion at all
 *  (fabricated). Backs a pack's out-of-core SC mappings (src/standards/validate.ts
 *  `classifySc`, src/standards/derive.ts) without hardcoding a single tolerated id. */
export function knownScStatus(id: string): ScStatus | undefined {
  return universeById.get(id)?.status;
}

/**
 * The terms WCAG normatively defines. Same contract as a pack's glossary, so one lookup
 * serves every standard — a country pack's tests and WCAG's own text both lean on defined
 * terms, and in both cases the definition is what decides the verdict.
 */
export function coreGlossary(lang: Lang = "en"): Glossary {
  const fr = data.glossaryFr;
  // Fall back to English only if a French set was never vendored (an older snapshot) —
  // never per-term, which would interleave the two languages in one lookup.
  return (lang === "fr" && fr && Object.keys(fr).length ? fr : data.glossary) ?? {};
}

export function allPrinciples(): WcagPrinciple[] {
  return data.principles;
}

export function allGuidelines(): WcagGuideline[] {
  return data.guidelines;
}

// Default `lang` stays "en" so every pre-existing call site (no lang argument) keeps
// rendering the authoritative W3C English title — back-compat, no behaviour change.
// `lang: "fr"` resolves the W3C AUTHORIZED French translation (titleFr); falls back to
// the English title if a French title is ever absent (should not happen for core-AA —
// the build guarantees completeness, see scripts/build-standards.mjs).
export function principleTitle(n: number, lang: Lang = "en"): string | undefined {
  const p = data.principles.find((p) => p.number === n);
  if (!p) return undefined;
  return lang === "fr" ? (p.titleFr ?? p.title) : p.title;
}

export function guidelineTitle(n: string, lang: Lang = "en"): string | undefined {
  const g = data.guidelines.find((g) => g.number === n);
  if (!g) return undefined;
  return lang === "fr" ? (g.titleFr ?? g.title) : g.title;
}

/** The criterion's normative wording in the requested language, verbatim from the W3C
 *  source (English) or its authorized French translation. */
export function scText(id: string, lang: Lang = "en"): string | undefined {
  const sc = byId.get(id);
  if (!sc) return undefined;
  return lang === "fr" ? (sc.textFr ?? sc.text) : sc.text;
}

/** Localized success-criterion title. `getSC(id)?.title` stays the raw English record;
 *  use this wherever a title is RENDERED so `--lang fr` resolves the authorized French
 *  translation. */
export function scTitle(id: string, lang: Lang = "en"): string | undefined {
  const sc = byId.get(id);
  if (!sc) return undefined;
  return lang === "fr" ? (sc.titleFr ?? sc.title) : sc.title;
}

/** SCs grouped by guideline ("1.4" → [...]), in dataset (numbering) order. */
export function scsByGuideline(): Map<string, Sc[]> {
  const m = new Map<string, Sc[]>();
  for (const c of data.criteria) (m.get(c.guideline) ?? m.set(c.guideline, []).get(c.guideline)!).push(c);
  return m;
}

/** SCs grouped by principle (1..4 → [...]), in dataset (numbering) order. */
export function scsByPrinciple(): Map<number, Sc[]> {
  const m = new Map<number, Sc[]>();
  for (const c of data.criteria) (m.get(c.principle) ?? m.set(c.principle, []).get(c.principle)!).push(c);
  return m;
}

export function automatability(id: string): Automatability | undefined {
  return byId.get(id)?.automatability;
}

export function techniques(id: string): string[] {
  return byId.get(id)?.techniques ?? [];
}

export function ruleIds(id: string): string[] {
  return byId.get(id)?.ruleIds ?? [];
}

export function understanding(id: string): string | undefined {
  return byId.get(id)?.understanding;
}

export function meta(): Pick<WcagData, "wcagVersion" | "level" | "source" | "license" | "criteriaSource"> {
  return {
    wcagVersion: data.wcagVersion,
    level: data.level,
    source: data.source,
    license: data.license,
    criteriaSource: data.criteriaSource,
  };
}

/** Numeric SC compare: sorts "1.4.10" after "1.4.3" (version tuples). Moved from standard.ts. */
export function compareSC(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export { data as wcag };

/** The W3C technique/failure ids recorded for a success criterion — the set a non-conformity
 *  on that criterion may legitimately cite. Empty when the dataset records none. */
export function techniquesFor(id: string): string[] {
  return getSC(id)?.techniques ?? [];
}
