// The audit work plan, and the inventory of standards it can be built for.
//
// An auditor's first question is not "what does criterion 8.3 say" — it is "what am I
// actually on the hook for". Which criteria does the engine settle from source? Which need
// a captured page, or a real browser? Which will no tool ever decide for me?
//
// Answering that from the wording of a test is guesswork. Answering it from
// `src/standards/coverage.ts` is a lookup over the engine's own rule applicability and the
// WCAG automatability classes — so the plan and the projection can never disagree.
//
// The vocabulary is ENGLISH regardless of the standard's own language: this is a worldwide
// tool, and an evidence tier is a fact about the engine, not about the country.
import { criteriaIndex } from "./criteria-view.js";
import { getDataset, hasGuidance } from "./guidance/index.js";
import {
  allCriteria,
  criterionCoverage,
  getPack,
  isCore,
  listPacks,
  listStandards,
  loadPack,
  packGlossary,
  standardCoverage,
  standardLabel,
  titlePlain,
  type StandardId,
  type Tier,
} from "./standards/index.js";
import { allSC, coreGlossary, meta, scTitle } from "./wcag.js";
import type { Lang } from "./types.js";

// ---- the inventory --------------------------------------------------------

export interface StandardSummary {
  key: string;
  core: boolean;
  label: string;
  counts: Record<string, number>;
  byTier: Record<string, number>;
  glossary: number;
  guidance: number;
  [extra: string]: unknown;
}

function tierCensus(standard: StandardId, ids: string[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const id of ids) {
    const t = criterionCoverage(standard, id)?.tier;
    if (t) by[t] = (by[t] ?? 0) + 1;
  }
  return by;
}

function summarize(key: StandardId): StandardSummary {
  if (isCore(key)) {
    const scs = allSC();
    const byAuto: Record<string, number> = {};
    for (const c of scs) byAuto[c.automatability] = (byAuto[c.automatability] ?? 0) + 1;
    return {
      key,
      core: true,
      label: standardLabel(key),
      ...meta(),
      counts: { criteria: scs.length, ...byAuto },
      byTier: tierCensus(
        key,
        scs.map((c) => c.sc),
      ),
      // The core keeps its terms in wcag.json, not in a pack glossary — it defines "large
      // scale" and "pure decoration" itself, and those definitions decide its verdicts.
      glossary: Object.keys(coreGlossary()).length,
      guidance: getDataset(key)?.entries.length ?? 0,
    };
  }
  const pack = loadPack(key);
  const criteria = allCriteria(pack);
  return {
    key,
    core: false,
    label: standardLabel(key),
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
    counts: {
      themes: pack.themes.length,
      criteria: criteria.length,
      tests: criteria.reduce((n, c) => n + Object.keys(c.tests ?? {}).length, 0),
      judgment: criteria.filter((c) => c.judgment).length,
      noEngineRule: criteria.filter((c) => c.appliesTo?.ruleIds?.length === 0).length,
      declarativeRules: pack.rules?.length ?? 0,
    },
    byTier: tierCensus(
      key,
      criteria.map((c) => c.id),
    ),
    glossary: Object.keys(packGlossary(key) ?? {}).length,
    guidance: hasGuidance(key) ? (getDataset(key)?.entries.length ?? 0) : 0,
    ...(pack.sampleMethodology ? { sampleKinds: pack.sampleMethodology.requiredKinds.length } : {}),
  };
}

export function standardsInventory(): Record<string, unknown> {
  const keys = listStandards();
  return {
    default: "wcag",
    count: keys.length,
    standards: keys.map(summarize),
    // Nothing here is a claim about the project's conformance — it is what the project
    // COULD be audited against.
    next: "ultra11y_method for the work plan of one of these; ultra11y_criteria to read a criterion.",
    builtIn: listPacks().map((p) => p.key),
  };
}

// ---- the work plan --------------------------------------------------------

/** What produces the evidence for a tier, and what gathering it actually involves. */
const TIER_GUIDE: Record<Tier, { tool: string; how: string }> = {
  source: {
    tool: "ultra11y_audit",
    how: "Run ultra11y_audit over the project's markup. An engine rule decides these: on a file that WAS audited, the absence of a finding is a real pass.",
  },
  "cross-file": {
    tool: "ultra11y_audit (graph: true)",
    how: "Statically decidable, but only across the dependency graph — a label defined in another file. Re-run the audit with graph: true.",
  },
  "rendered-page": {
    tool: "ultra11y render / dev / the Playwright or Cypress plugin",
    how: "Capture a page snapshot into .ultra11y/pages first, then audit again. These rules read computed styles, laid-out boxes and the screenshot — a captured page, but no live browser.",
  },
  browser: {
    tool: "ultra11y scan (CLI)",
    how: "Needs a live rendered DOM. This server does not drive a browser: run `ultra11y scan <target> --merge` from the CLI, then audit again.",
  },
  judgment: {
    tool: "ultra11y_adjudicate",
    how: "The evidence can be gathered but the verdict is a reading of meaning — is this alt text relevant, is this link's purpose clear in context. ultra11y_adjudicate hands you the evidence and the decision rule; you rule, citing the criterion's own numbered test.",
  },
  "out-of-scope": {
    tool: "—",
    how: "Every WCAG success criterion this maps to is outside the engine's 2.2 AA core (AAA, or removed). Declare it out of scope. Never claim conformity.",
  },
};

const TIERS: Tier[] = ["source", "cross-file", "rendered-page", "browser", "judgment", "out-of-scope"];

export interface MethodOptions {
  tier?: Tier;
  detail?: "summary" | "full";
}

function titleOf(standard: StandardId, id: string, lang: Lang): string {
  if (isCore(standard)) {
    const t = scTitle(id, lang);
    return t ?? id;
  }
  const pack = loadPack(standard);
  const c = allCriteria(pack).find((x) => x.id === id);
  return c ? titlePlain(pack, c, lang) : id;
}

export function methodView(standard: StandardId, lang: Lang, opts: MethodOptions = {}): Record<string, unknown> {
  const coverage = standardCoverage(standard);
  const detail = opts.detail ?? "summary";

  const buckets = TIERS.map((tier) => {
    const entries = [...coverage].filter(([, c]) => c.tier === tier);
    return {
      tier,
      count: entries.length,
      sourceIsEnough: tier === "source",
      ...TIER_GUIDE[tier],
      criteria: entries.map(([id, c]) =>
        detail === "full"
          ? { id, title: titleOf(standard, id, lang), rules: c.engineRules, alsoNeeds: c.alsoNeeds, canFailFrom: c.canFailFrom, why: c.why }
          : { id },
      ),
    };
  }).filter((b) => (opts.tier ? b.tier === opts.tier : b.count > 0));

  const sourceIds = [...coverage].filter(([, c]) => c.sourceIsEnough).map(([id]) => id);
  // Deliberately a SECOND axis. A criterion can be un-provable from source yet perfectly
  // failable from it — RGAA 4.10 is judgment-flagged and still carries autoplay rules.
  // Collapsing the two into one boolean throws away real coverage.
  const failableFromSource = [...coverage].filter(([, c]) => !c.sourceIsEnough && c.canFailFrom.includes("source")).map(([id]) => id);
  const evidenceTiers = (["source", "cross-file", "rendered-page", "browser"] as const)
    .map((tier) => {
      const ids = [...coverage].filter(([, criterion]) => criterion.canFailFrom.includes(tier)).map(([id]) => id);
      return { tier, count: ids.length, ids, ...TIER_GUIDE[tier] };
    })
    .filter((entry) => entry.count > 0);

  const pack = isCore(standard) ? undefined : getPack(standard);
  return {
    standard,
    standardLabel: standardLabel(standard),
    lang,
    total: coverage.size,
    detail,
    buckets,
    sourceIsEnough: { count: sourceIds.length, ids: sourceIds },
    needsMore: { count: coverage.size - sourceIds.length },
    canFailFromSource: {
      count: failableFromSource.length,
      ids: failableFromSource,
      note: "These cannot be PROVEN conformant from source, but an engine rule can still fail them outright.",
    },
    evidenceTiers,
    ...(pack?.sampleMethodology
      ? {
          sample: {
            requiredKinds: pack.sampleMethodology.requiredKinds.map((k) => ({ id: k.id, label: k.label[lang] ?? k.label[pack.defaultLocale] })),
            note: "This standard is a PER-PAGE norm: the plan above applies to each page of the declared sample. Lint the sample with ultra11y_sample_check.",
          },
        }
      : {}),
    coverageNote:
      "A criterion nobody tested is untested, never conformant. Every count above is derived from this engine's own rule applicability and the WCAG " +
      "automatability classes — not from reading the wording of a test.",
    next: "ultra11y_audit to settle the `source` tier, then ultra11y_adjudicate for the judgment ones.",
  };
}

/** The criteria index, re-exported so the reference tools share one entry point. */
export { criteriaIndex };
