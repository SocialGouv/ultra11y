// The GUIDANCE registry — parallel to the standards registry. The built-in RGAA
// implementation guidance is inlined by tsup (like wcag.json / rgaa.json); external
// guidance datasets are added at runtime by the `--pack` / .ultra11yrc.json loader
// (src/config.ts). Lookups are by WCAG SC (core view) or by pack criterion (pack view),
// so the report/PRD can attach concrete before/after examples without touching the
// canonical AuditResult.
import rgaaGuidance from "../data/guidance/rgaa.json";
import wcagGuidance from "../data/guidance/wcag.json";
import type { GuidanceDataset, GuidanceEntry } from "./types.js";

const datasets = new Map<string, GuidanceDataset>();

function add(ds: GuidanceDataset): void {
  datasets.set(ds.pack, ds);
}

// The WCAG-keyed dataset goes in FIRST, so a pack's own entry always sorts ahead of an
// inherited one (`resolveGuidance` keeps first-seen per criterion, and the pack is queried
// before the crosswalk anyway — this only fixes the order among inherited entries).
//
// Its reason to exist: every guidance entry declares the success criteria it implements,
// and `guidanceForWcag` walks EVERY dataset, so the RGAA entries are already reachable from
// any pack that maps to the same SC. What no French-authored dataset can supply is the ten
// AA criteria RGAA 4.1.2 never covered — six of them added in WCAG 2.2, after it froze. A
// pack for any other country inherits those from here.
add(wcagGuidance as unknown as GuidanceDataset);
add(rgaaGuidance as unknown as GuidanceDataset);

/** Register an external guidance dataset at runtime (from --pack / .ultra11yrc.json). */
export function registerRuntimeGuidance(ds: GuidanceDataset): void {
  add(ds);
}

/** Every guidance entry (across datasets) whose criterion implements this WCAG SC,
 *  in a stable order (dataset registration order, then entry order) for reproducibility. */
export function guidanceForWcag(sc: string): GuidanceEntry[] {
  const out: GuidanceEntry[] = [];
  // Defensive: a runtime dataset entry may omit `wcag` — never let a lookup throw.
  for (const ds of datasets.values()) for (const e of ds.entries) if (Array.isArray(e.wcag) && e.wcag.includes(sc)) out.push(e);
  return out;
}

/** Guidance entries pinned to a specific pack criterion (e.g. rgaa "1.2"). */
export function guidanceForCriterion(packKey: string, criterionId: string): GuidanceEntry[] {
  return datasets.get(packKey)?.entries.filter((e) => e.criterionId === criterionId) ?? [];
}

export function hasGuidance(packKey: string): boolean {
  return datasets.has(packKey);
}

export function getDataset(packKey: string): GuidanceDataset | undefined {
  return datasets.get(packKey);
}

export * from "./types.js";
