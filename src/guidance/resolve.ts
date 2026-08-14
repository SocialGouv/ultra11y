// Guidance for one criterion, wherever it lives — the lookup that makes a new country pack
// useful the day it lands.
//
// A standards pack says WHAT a criterion requires; guidance says HOW to implement it, as a
// before/after pair. Only RGAA ships a guidance dataset today, so a freshly authored
// Section 508 or EN 301 549 pack would have none of its own. But every guidance entry
// carries the WCAG success criteria it implements, and `guidanceForWcag` walks EVERY
// registered dataset — so a new pack's criterion inherits the examples keyed to the same
// SC, for free, from data already in the bundle.
//
// This chain already existed inside `guidanceFor` in src/prd.ts, keyed on a PrdUnit, which
// meant nothing but the PRD could reach it. Here it is keyed on a criterion id, and it
// records HOW each entry was found: an inherited example must never be presented as the
// national standard's own doctrine.
import { guidanceForCriterion, guidanceForWcag } from "./index.js";
import type { GuidanceEntry } from "./types.js";
import { getCriterion } from "../standards/pack.js";
import { getPack, isCore } from "../standards/registry.js";
import type { StandardId } from "../standards/index.js";
import type { Lang } from "../types.js";

export interface ResolvedGuidance {
  entry: GuidanceEntry;
  /** "pack" when pinned to this criterion; "wcag:<sc>" when inherited through the mapping. */
  via: string;
  /** True when this came from another standard's dataset via the WCAG crosswalk. */
  inherited: boolean;
  /** The languages this entry actually has text in — it may not include the active one. */
  languagesAvailable: Lang[];
}

const LANGS: Lang[] = ["en", "fr"];

function languagesOf(e: GuidanceEntry): Lang[] {
  return LANGS.filter((l) => e.title?.[l] || e.summary?.[l]);
}

/**
 * Guidance for a criterion, in a stable order, deduped by entry id.
 *
 * Order: the pack's own entries first, then the entries keyed to each WCAG success
 * criterion it maps to, in the pack's own SC order. First occurrence wins, so a pack that
 * writes its own guidance for a criterion is never overridden by an inherited one.
 */
export function resolveGuidance(standard: StandardId, criterionId: string, wcagRefs?: string[]): ResolvedGuidance[] {
  const seen = new Set<string>();
  const out: ResolvedGuidance[] = [];
  const push = (entries: GuidanceEntry[], via: string, inherited: boolean) => {
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push({ entry, via, inherited, languagesAvailable: languagesOf(entry) });
    }
  };

  if (isCore(standard)) {
    // The id IS a success criterion, so nothing is inherited — this is its own guidance.
    push(guidanceForWcag(criterionId), `wcag:${criterionId}`, false);
    return out;
  }

  push(guidanceForCriterion(standard, criterionId), "pack", false);
  const refs = wcagRefs ?? getCriterion(getPack(standard)!, criterionId)?.wcag ?? [];
  for (const sc of refs) push(guidanceForWcag(sc), `wcag:${sc}`, true);
  return out;
}

/** The plain entries, in the same order — the shape the PRD and report already consume. */
export function guidanceEntriesFor(standard: StandardId, criterionId: string, wcagRefs?: string[]): GuidanceEntry[] {
  return resolveGuidance(standard, criterionId, wcagRefs).map((r) => r.entry);
}
