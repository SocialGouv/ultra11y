// What it actually takes to decide a criterion — derived, never guessed.
//
// Before auditing anything, an auditor needs the plan: which criteria the static engine
// settles from source alone, which need a captured page or a real browser, and which are
// judgment calls no tool can make. Getting that wrong in either direction is expensive — a
// criterion wrongly filed as "the engine has it" becomes a conformance claim nobody tested.
//
// So every classification here is a LOOKUP over data the repo already ships:
//
//   - `automatability` per WCAG success criterion (src/data/wcag.json): 3 static,
//     14 needs-rendering, 38 judgment — the 3/14/38 arithmetic quoted across the tool.
//   - `appliesTo.ruleIds` per pack criterion: which engine rules can evidence it. EMPTY is
//     a statement, not a gap — 55 of RGAA's 106 criteria say "no engine rule can attest
//     this", and that fact is the single most useful thing in an audit plan.
//   - `judgment: true` per pack criterion: the criterion asks more than its mapped SCs, so
//     `judgmentGuard` in derive.ts refuses to let it inherit a Conforming verdict.
//   - which registry a rule id belongs to, for the tier that produces it.
//
// Nothing here reads the WORDING of a test.
import { ALL_RULES } from "../rules/registry.js";
import { CROSS_RULES } from "../rules/cross-registry.js";
import { allSC, getSC, knownScStatus } from "../wcag.js";
import { allCriteria, getCriterion } from "./pack.js";
import { isCore, loadPack } from "./registry.js";
import type { StandardId } from "./index.js";
import type { PackCriterion, StandardPack } from "./types.js";

/** The evidence source a verdict rests on, cheapest first. */
export type Tier = "source" | "cross-file" | "rendered-page" | "browser" | "judgment" | "out-of-scope";

/** Tiers ordered by cost. `judgment` and `out-of-scope` are terminal, not cheaper/dearer. */
const TIER_ORDER: Tier[] = ["source", "cross-file", "rendered-page", "browser"];

export interface Coverage {
  /** The cheapest tier that can prove this criterion CONFORMANT. */
  tier: Tier;
  /** True only when the source tree alone settles it. */
  sourceIsEnough: boolean;
  /**
   * The tiers that can raise a NON-conformity on it — deliberately a separate axis.
   * RGAA 4.10 and 8.4 are `judgment: true` (so no tool may declare them conformant) and
   * still carry real engine rules that can fail them. Collapsing the two axes into one
   * boolean, as a wording-heuristic must, throws that coverage away.
   */
  canFailFrom: Tier[];
  /** Tiers beyond `tier` that also carry evidence. */
  alsoNeeds: Tier[];
  /** The engine rules declared applicable to this criterion. */
  engineRules: string[];
  /** False when the pack declares no applicability at all — the plan is then coarser. */
  applicabilityDeclared: boolean;
  /** One English sentence naming the datum that decided this. */
  why: string;
}

const STATIC_RULE_IDS = new Set(ALL_RULES.map((r) => r.id));
const CROSS_RULE_IDS = new Set(CROSS_RULES.map((r) => r.id));

/**
 * The tier that produces a finding with this rule id. Namespace dispatch — no regex over
 * prose, no per-id special cases.
 */
export function ruleTier(ruleId: string, pack?: StandardPack): Tier {
  // A pack's own declarative rule runs inside the static pipeline.
  if (ruleId.startsWith("pack:")) return "source";
  // Agent findings are the model's ruling, by construction.
  if (ruleId.startsWith("agent:")) return "judgment";
  // axe checks and the dynamic probes only ever come back from `scan`.
  if (ruleId.startsWith("axe:") || ruleId.startsWith("dyn-")) return "browser";
  // A rendered rule reads a snapshot's computed styles, boxes and screenshot — a captured
  // page, but no live browser.
  if (ruleId.startsWith("rendered-")) return "rendered-page";
  if (CROSS_RULE_IDS.has(ruleId)) return "cross-file";
  if (STATIC_RULE_IDS.has(ruleId)) return "source";
  // A wildcard (`*`) is the legacy fan-out: it matches every engine finding, so the static
  // tier is the honest floor. Anything else is an id no registry claims.
  if (pack && ruleId.endsWith("*")) return "source";
  return "source";
}

function cheapest(tiers: Tier[]): Tier | undefined {
  for (const t of TIER_ORDER) if (tiers.includes(t)) return t;
  return undefined;
}

function dedupe(tiers: Tier[]): Tier[] {
  return TIER_ORDER.filter((t) => tiers.includes(t));
}

/** Coverage for one WCAG success criterion. */
function coreCoverage(sc: string): Coverage | undefined {
  const c = getSC(sc);
  if (!c) return undefined;
  const engineRules = [...c.ruleIds];
  const tiers = engineRules.map((r) => ruleTier(r));

  if (c.automatability === "judgment") {
    return {
      tier: "judgment",
      sourceIsEnough: false,
      canFailFrom: dedupe(tiers),
      alsoNeeds: [],
      engineRules,
      applicabilityDeclared: true,
      why: "WCAG automatability class `judgment`: the evidence can be gathered, but the verdict is a reading of meaning.",
    };
  }
  if (c.automatability === "needs-rendering") {
    const tier: Tier = tiers.includes("rendered-page") ? "rendered-page" : "browser";
    return {
      tier,
      sourceIsEnough: false,
      canFailFrom: dedupe(tiers),
      alsoNeeds: dedupe(tiers).filter((t) => t !== tier),
      engineRules,
      applicabilityDeclared: true,
      why:
        tier === "rendered-page"
          ? "WCAG automatability class `needs-rendering`, and a rendered-* rule covers it: a captured page snapshot is enough, no live browser."
          : "WCAG automatability class `needs-rendering`: only a real browser produces this evidence.",
    };
  }
  const tier = cheapest(tiers) ?? "source";
  return {
    tier,
    sourceIsEnough: tier === "source",
    canFailFrom: dedupe(tiers),
    alsoNeeds: dedupe(tiers).filter((t) => t !== tier),
    engineRules,
    applicabilityDeclared: true,
    why: "WCAG automatability class `static`: an engine rule decides it from the source tree.",
  };
}

/**
 * Every mapped SC sits outside the engine's WCAG 2.2 AA core (AAA, or removed).
 *
 * Deliberately the SAME predicate as `derivePackResults` in derive.ts — a criterion the
 * projection files as out of scope must be the one the plan files as out of scope, or the
 * plan is telling the auditor to gather evidence for a verdict that can never be rendered.
 */
function outOfCore(pack: StandardPack, pc: PackCriterion): boolean {
  // …INCLUDING THE EXEMPTION derive.ts carries, which this had stopped mirroring. A pack may
  // ship its own declarative rules, and one of them can decide a criterion whose whole WCAG
  // mapping is outside the core. RGAA 8.1 is that criterion: it maps only onto the REMOVED
  // 4.1.1, so the plan filed it « out of scope » — while the projection decided it from this
  // pack's own `doctype-missing` rule, reading the doctype off every capture. The plan was
  // telling an auditor not to bother gathering evidence for a verdict the tool was already
  // rendering, which is the exact drift the comment above forbids.
  const ownRuleIds = new Set((pack.rules ?? []).map((r) => `pack:${pack.key}:${r.id}`));
  if ((pc.appliesTo?.ruleIds ?? []).some((id) => ownRuleIds.has(id))) return false;
  return pc.wcag.every((sc) => {
    const s = knownScStatus(sc);
    return s === "out-of-core" || s === "removed";
  });
}

function packCoverage(pack: StandardPack, pc: PackCriterion): Coverage {
  if (outOfCore(pack, pc)) {
    return {
      tier: "out-of-scope",
      sourceIsEnough: false,
      canFailFrom: [],
      alsoNeeds: [],
      engineRules: [],
      applicabilityDeclared: true,
      why: `every WCAG success criterion this maps to (${pc.wcag.join(", ")}) is outside the engine's 2.2 AA core — AAA or removed. Declare it out of scope; never claim conformity.`,
    };
  }

  const declared = pc.appliesTo?.ruleIds;
  if (declared === undefined) {
    // No applicability at all: classify from the mapped SCs alone, and say the plan is
    // coarser than it would be for a pack that declares one.
    const tiers = pc.wcag.map((sc) => coreCoverage(sc)?.tier).filter((t): t is Tier => t !== undefined);
    const tier = tiers.includes("judgment") ? "judgment" : (cheapest(tiers) ?? "judgment");
    return {
      tier,
      sourceIsEnough: tier === "source",
      canFailFrom: dedupe(tiers),
      alsoNeeds: dedupe(tiers).filter((t) => t !== tier),
      engineRules: [],
      applicabilityDeclared: false,
      why: "the pack declares no rule applicability, so this is inferred from the WCAG success criteria it maps to.",
    };
  }

  const engineRules = [...declared];
  const tiers = engineRules.map((r) => ruleTier(r, pack));

  if (pc.judgment) {
    return {
      tier: "judgment",
      sourceIsEnough: false,
      canFailFrom: dedupe(tiers),
      alsoNeeds: [],
      engineRules,
      applicabilityDeclared: true,
      why: "the standard flags this criterion as judgment: it asks more than its mapped success criteria, so it never inherits a Conforming verdict — though an engine rule can still fail it.",
    };
  }
  if (!engineRules.length) {
    return {
      tier: "judgment",
      sourceIsEnough: false,
      canFailFrom: [],
      alsoNeeds: [],
      engineRules,
      applicabilityDeclared: true,
      why: "the standard declares that no engine rule can evidence this criterion — it is yours to rule on.",
    };
  }
  const tier = cheapest(tiers) ?? "judgment";
  return {
    tier,
    sourceIsEnough: tier === "source",
    canFailFrom: dedupe(tiers),
    alsoNeeds: dedupe(tiers).filter((t) => t !== tier),
    engineRules,
    applicabilityDeclared: true,
    why: `the standard declares ${engineRules.length} applicable engine rule${engineRules.length === 1 ? "" : "s"}; the cheapest evidence tier among them is \`${tier}\`.`,
  };
}

/** Coverage for one criterion of any standard. Undefined when the id does not exist. */
export function criterionCoverage(standard: StandardId, id: string): Coverage | undefined {
  if (isCore(standard)) return coreCoverage(id);
  const pack = loadPack(standard);
  const pc = getCriterion(pack, id);
  return pc ? packCoverage(pack, pc) : undefined;
}

/** Coverage for every criterion of a standard, keyed by criterion id. */
export function standardCoverage(standard: StandardId): Map<string, Coverage> {
  const out = new Map<string, Coverage>();
  if (isCore(standard)) {
    for (const c of allSC()) {
      const cov = coreCoverage(c.sc);
      if (cov) out.set(c.sc, cov);
    }
    return out;
  }
  const pack = loadPack(standard);
  for (const pc of allCriteria(pack)) out.set(pc.id, packCoverage(pack, pc));
  return out;
}
